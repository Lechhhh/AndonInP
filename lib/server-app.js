'use strict';
const express = require('express');
const helmet = require('helmet');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const proxyaddr = require('proxy-addr');
const { Server } = require('socket.io');
const { Vault, loadKey } = require('./vault');
const { Accounts, ROLES, STATIONS } = require('./accounts');
const {label:stationLabel}=require('../public/stations');
const { Sessions } = require('./sessions');
const { Limiter, SecurityLog, publicFailure } = require('./security');
const { PublicError, denied } = require('./errors');
const { validate } = require('./validation');
const { Line } = require('./line');

async function createApplication(config) {
    const release=require('./lock').acquireLocks([config.accountsFile,config.stateFile,config.historyFile]);
    let cleanup,history;try {
    const vault = new Vault(loadKey(config));
    const logger = new SecurityLog(config.logsDir, vault, [config.webhook, config.masterKey]);
    const accounts = await Accounts.open(config.accountsFile, vault);
    history=new (require('./history').HistoryDatabase)(config.historyFile,vault);
    const line = new Line(config.stateFile,vault,Date.now,history);
    const sessions = new Sessions(config, accounts), limiter = new Limiter();
    const app = express(); app.disable('x-powered-by'); app.set('trust proxy', config.proxy);
    const server = config.directTls ? https.createServer({cert:fs.readFileSync(config.certFile),key:fs.readFileSync(config.tlsKeyFile),minVersion:'TLSv1.2'},app) : http.createServer(app);
    server.maxConnections=1000;server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
    const trust=app.get('trust proxy fn');
    const ip=req=>proxyaddr(req,trust);
    const allowedClient=config.allowedClients.length?proxyaddr.compile(config.allowedClients):()=>true;
    const isSecure=req=>Boolean(req.socket.encrypted || config.proxy && trust(req.socket.remoteAddress,0) && req.headers['x-forwarded-proto']==='https');
    function sameOrigin(req) {
        const origin=req.headers.origin;
        if(origin){try{const u=new URL(origin);return config.origins.length?config.origins.includes(origin):['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&u.host===req.headers.host&&u.protocol===(isSecure(req)?'https:':'http:');}catch{return false;}}
        return req.headers['sec-fetch-site']==='same-origin' && (!config.origins.length || config.origins.some(o=>new URL(o).host===req.headers.host));
    }
    const headers=helmet({
        contentSecurityPolicy:{useDefaults:false,directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],scriptSrcAttr:["'none'"],styleSrc:["'self'"],imgSrc:["'self'"],fontSrc:["'self'"],mediaSrc:["'self'"],connectSrc:["'self'"],objectSrc:["'none'"],baseUri:["'none'"],frameAncestors:["'none'"],formAction:["'self'"],...(config.secureCookies?{upgradeInsecureRequests:[]}: {})}},
        strictTransportSecurity:config.secureCookies?{maxAge:31536000,includeSubDomains:false}:false,
        crossOriginEmbedderPolicy:false,referrerPolicy:{policy:'no-referrer'}
    });
    const baseHeaders=(req,res,next)=>{headers(req,res,()=>{res.setHeader('Cache-Control','no-store');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)');next();});};
    app.use(baseHeaders);
    function audit(event,detail){try{logger.write(event,detail);}catch{console.error('[Andon] Nie udało się zapisać logu bezpieczeństwa.');}}
    function safeError(error,context) { try{return publicFailure(error,logger,context);}catch{return {ok:false,code:'INTERNAL_ERROR',error:'Usługa chwilowo niedostępna. Skontaktuj się z administratorem.'};} }
    app.use((req,res,next)=>{
        try{
            if(!allowedClient(ip(req),0))throw denied();
            if(config.production&&!isSecure(req))throw new PublicError('HTTPS_REQUIRED','Wymagane połączenie HTTPS.',426);
            if(!config.production&&!config.origins.length&&!['localhost','127.0.0.1','[::1]'].includes(new URL('http://'+req.headers.host).hostname))throw denied();
            limiter.take('http:'+ip(req),600,60000);next();
        }catch(e){next(e);}
    });
    app.get('/health',(_req,res)=>res.json({ok:true}));
    app.use('/api',(req,res,next)=>{if(!sameOrigin(req))return next(denied());next();});
    app.use('/api',express.json({limit:'16kb',strict:true,type:'application/json'}));
    const identity=user=>({userName:user.name,employeeId:user.id,role:user.role,roleName:ROLES[user.role],allowedStations:[...user.allowedStations]});
    const sessionReply=s=>{const user=s.userId&&accounts.get(s.userId);return {ok:true,authenticated:Boolean(user),csrfToken:s.csrf,...(user?identity(user):{})};};
    app.get('/api/session',(req,res)=>{
        let s=sessions.from(req);
        if(!s){limiter.take('session-create:'+ip(req),30,60000);s=sessions.create(res);}
        res.json(sessionReply(s));
    });
    app.post('/api/login',async(req,res)=>{
        const s=sessions.from(req);sessions.csrf(s,req.headers['x-csrf-token']);
        limiter.take('login-ip:'+ip(req),15,5*60000);
        const data=validate('login',req.body);
        limiter.take('login-code:'+vault.lookup(data.code),10,5*60000);
        const user=await accounts.authenticate(data.code);
        // Verification yields to other requests, including logout and session rotation.
        sessions.csrf(sessions.current(s.key),req.headers['x-csrf-token']);
        if(!user){logger.write('login_failed',{ip:ip(req)});throw new PublicError('BAD_LOGIN','Nieprawidłowy numer lub konto jest nieaktywne.',401);}
        // Login rotates the opaque cookie; an older session never inherits a new identity.
        sessions.remove(s.key);disconnectInvalid();
        const next=sessions.create(res,user);audit('login_success',{userId:user.id,role:user.role,ip:ip(req)});res.json(sessionReply(next));
    });
    app.post('/api/logout',(req,res)=>{
        validate('logout',req.body);const s=sessions.from(req);sessions.csrf(s,req.headers['x-csrf-token']);
        sessions.remove(s.key);sessions.clearCookie(res);disconnectInvalid();audit('logout',{userId:s.userId});res.json({ok:true});
    });
    app.get('/client-config',(_req,res)=>res.json({panelPath:config.panelPath,showPanelLink:config.showPanelLink}));
    app.get([config.panelPath,config.panelPath+'/'],(_req,res)=>res.sendFile(path.join(config.root,'public/control-panel.html')));
    app.get('/control-panel.html',(_req,res)=>res.redirect(config.panelPath));
    app.use(express.static(path.join(config.root,'public'),{dotfiles:'deny',index:'index.html',etag:false}));
    app.use((_req,_res,next)=>next(new PublicError('NOT_FOUND','Nie znaleziono zasobu.',404)));
    app.use((error,req,res,_next)=>{
        if(error.type==='entity.too.large')error=new PublicError('TOO_LARGE','Przekroczono dozwolony rozmiar żądania.',413);
        else if(error.type==='entity.parse.failed')error=new PublicError('INVALID_JSON','Nieprawidłowy format danych.',400);
        const result=safeError(error,{ip:ip(req),method:req.method});
        if(result.retryAfter)res.setHeader('Retry-After',String(result.retryAfter));res.status(error instanceof PublicError?error.status:500).json(result);
    });
    const connections=new Map();
    const io=new Server(server,{maxHttpBufferSize:16384,perMessageDeflate:false,allowRequest(req,done){
        try{if(!allowedClient(ip(req),0)||config.production&&!isSecure(req)||!sameOrigin(req))throw denied();limiter.take('handshake:'+ip(req),60,60000);if((connections.get(ip(req))||0)>=20)throw new PublicError('LIMIT','Zbyt wiele połączeń.',429);done(null,true);}catch{done('Connection rejected',false);}
    }});
    io.engine.use(baseHeaders);
    io.use((socket,next)=>{
        try{
            if(Object.keys(socket.handshake.auth).some(k=>!['view','csrfToken'].includes(k)))throw denied();
            const s=sessions.from(socket.request);sessions.csrf(s,socket.handshake.auth.csrfToken);
            const view=validate('view',socket.handshake.auth.view);
            const user=s&&s.userId&&accounts.get(s.userId);if(!user||!canView(user,view))throw denied();
            socket.data.sessionKey=s.key;socket.data.view=view;socket.data.ip=ip(socket.request);
            next();
        }catch(e){const error=new Error('Brak ważnej sesji lub uprawnień.');error.data={code:e instanceof PublicError?e.code:'UNAUTHORIZED'};next(error);}
    });
    function canView(user,view){return STATIONS.includes(view)?user.allowedStations.includes(view):['owner','manager'].includes(user.role)&&['tv','panel'].includes(view);}
    function actor(socket){const s=sessions.current(socket.data.sessionKey),user=s&&s.userId&&accounts.get(s.userId);if(!user||!canView(user,socket.data.view))throw denied();return {s,user,view:socket.data.view};}
    function disconnectInvalid(){for(const socket of io.sockets.sockets.values()){try{actor(socket);}catch{socket.emit('sessionRevoked',{error:'Sesja wygasła lub dostęp został zmieniony. Zaloguj się ponownie.'});socket.disconnect(true);}}}
    function broadcast(){for(const socket of io.sockets.sockets.values()){try{const {user,view}=actor(socket);socket.emit('sync',line.snapshot(view,user));}catch{socket.disconnect(true);}}}
    const lineEvents=new Set(['actionOK','callSupport','cancelSupport','adminSettings','shiftStart','shiftStop','plannerAdd','plannerRemove','setBreakOverlayDisabled']);
    const usersEvents={userCreate:'create',userUpdate:'update',userDelete:'delete'};
    const known=new Set([...lineEvents,...Object.keys(usersEvents),'usersList','historyQuery','historyExport']);
    io.on('connection',socket=>{
        const address=socket.data.ip;connections.set(address,(connections.get(address)||0)+1);
        socket.on('disconnect',()=>{const count=(connections.get(address)||1)-1;if(count)connections.set(address,count);else connections.delete(address);});
        socket.use((packet,next)=>{try{const {user}=actor(socket);limiter.take('socket-ip:'+address,300,10000);limiter.take('user-events:'+user.id,100,10000);if(!known.has(packet[0]))throw new PublicError('UNKNOWN_EVENT','Nieznana operacja.');next();}catch(error){const ack=packet.at(-1);if(typeof ack==='function')ack(safeError(error,{ip:address,event:String(packet[0]).slice(0,50)}));}});
        for(const event of known)socket.on(event,async(data,ack)=>{
            if(typeof ack!=='function')return;
            try{
                const {s,user,view}=actor(socket);
                const payload=validate(event,data);
                let result;
                if(event==='historyQuery'||event==='historyExport'){
                    if(view!=='panel'||!['owner','manager'].includes(user.role))throw denied();
                    limiter.take('history:'+event+':'+user.id,event==='historyQuery'?30:600,60000);
                    result=history.query(payload,event==='historyQuery');
                }else if(event==='usersList'||Object.hasOwn(usersEvents,event)){
                    if(user.role!=='owner'||view!=='panel')throw denied();
                    limiter.take('users:'+user.id,event==='usersList'?60:20,60000);
                    if(event==='usersList')result={ok:true,...accounts.list(payload)};
                    else{
                        result={ok:true,...await accounts.mutate(user.id,usersEvents[event],payload,()=>actor(socket))};
                        if(event!=='userCreate')sessions.revokeUser(result.userId);
                        audit('account_changed',{actorId:user.id,targetId:result.userId,action:event});
                    }
                }else{
                    if(['actionOK','callSupport','cancelSupport'].includes(event)){if(!STATIONS.includes(view))throw denied();}
                    else if(view!=='panel'||!['owner','manager'].includes(user.role))throw denied();
                    limiter.take('operation:'+user.id+':'+event,event==='callSupport'?3:event==='actionOK'?30:20,60000);
                    result=line.change(event,payload,user,view);audit('operation',{userId:user.id,view,event});
                }
                sessions.touch(s);ack(result);
                if(Object.hasOwn(usersEvents,event)){disconnectInvalid();for(const other of io.sockets.sockets.values()){const current=sessions.current(other.data.sessionKey);const u=current&&accounts.get(current.userId);if(u&&u.role==='owner'&&other.data.view==='panel')other.emit('usersChanged');}}
                else if(lineEvents.has(event))broadcast();
            }catch(error){ack(safeError(error,{ip:address,event}));}
        });
        const {user,view}=actor(socket);socket.emit('sync',line.snapshot(view,user));
    });
    let sending=false;
    async function notifications(){
        if(sending||!config.webhook)return;
        const entry=line.state.outbox.find(e=>e.nextTry<=Date.now());if(!entry)return;sending=true;
        try{
            const url=new URL(config.webhook);
            if(url.protocol!=='https:'||url.hostname!=='discord.com'||!/^\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(url.pathname)||url.search||url.username||url.password||url.port)throw new Error('Invalid Discord destination.');
            const response=await fetch(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'Andon System',allowed_mentions:{parse:[]},embeds:[{title:'Wezwanie wsparcia',description:'Stanowisko: '+stationLabel(entry.station)+'\nPowód: '+entry.reason+(entry.comment?'\nKomentarz: '+entry.comment:''),color:15158332}]}),signal:AbortSignal.timeout(8000)});
            if(!response.ok)throw new Error('Notification HTTP '+response.status);
            line.finishNotification(entry.id,true);logger.write('notification_sent',{notificationId:entry.id});
        }catch(error){try{line.finishNotification(entry.id,false);logger.error(error,{notificationId:entry.id});}catch{console.error('[Andon] Błąd zapisu kolejki lub logu.');}}finally{sending=false;}
    }
    const clockTimer=setInterval(()=>{try{line.tick();sessions.sweep();disconnectInvalid();broadcast();}catch(error){try{logger.error(error,{event:'clock'});}catch{}for(const socket of io.sockets.sockets.values())socket.emit('serviceError',{error:'Błąd zapisu stanu. Skontaktuj się z administratorem.'});}},1000);
    const notifyTimer=setInterval(notifications,10000);
    cleanup=()=>{clearInterval(clockTimer);clearInterval(notifyTimer);io.close();};
    logger.write('server_started',{mode:config.production?'production':'local'});
    return {app,server,io,accounts,line,sessions,limiter,config,vault,history,
        async listen(){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,config.host,resolve);});return server.address();},
        async close(){clearInterval(clockTimer);clearInterval(notifyTimer);await new Promise(resolve=>io.close(resolve));if(server.listening)await new Promise(resolve=>server.close(resolve));history.close();release();}
    };
    }catch(error){if(cleanup)cleanup();if(history)history.close();release();throw error;}
}
module.exports={createApplication};
