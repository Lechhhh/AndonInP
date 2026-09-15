
        // Zabezpieczenie: jeśli biblioteka socket.io się nie załadowała
        // (np. strona otwarta jako plik file:// lub przez inny serwer niż Node,
        //  albo serwer nie działa i /socket.io/socket.io.js zwraca 404),
        // to io jest undefined. Bez tego guardu ReferenceError ubijał CAŁY skrypt,
        // przez co nie działało logowanie ani zmiana stanowiska.
        let socket;
        if (typeof io === 'function') {
            socket = io({autoConnect:false,reconnection:true,reconnectionDelayMax:5000});
        } else {
            console.error('[Andon] Nie załadowano socket.io. Otwórz aplikację przez serwer Node (np. http://localhost:3000), a nie jako plik.');
            socket = { on() {}, emit() {} }; // stub – interfejs logowania nadal działa
            document.addEventListener('DOMContentLoaded', () => {
                const m = document.getElementById('l-msg');
                if (m) m.innerText = 'Brak połączenia z serwerem. Uruchom serwer (npm start) i otwórz http://localhost:3000';
            });
        }
        let localDB = null;
        let currentUser = null; 
        let currentUserName = null, currentDepartment = 'electro', secondOperatorName = null, panelPath = '/panelsterowania';
        let loginPending = false, intentionalLogout = false;
        let pendingOK = null, operatorCycleId = null, okAvailableAt = 0, okCooldownTimer;
        const OK_COOLDOWN_MS = 1500;
        const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        fetch('/client-config').then(r => r.json()).then(config => {
            panelPath=config.panelPath||panelPath; document.querySelectorAll('.panel-link').forEach(link => { link.href = panelPath; link.classList.toggle('hidden', !config.showPanelLink); });
        }).catch(() => {});
        socket.on('sessionRevoked', result => { resetSession(result.error); socket.disconnect(); });
        const CFG = { stations: ['y0','y1','y2','y3','y4'] };

        const connectionBanner = document.getElementById('connection-banner');
        let connectedOnce=false, disconnectTimer=null;
        const setConnected = connected => { if(!connectionBanner)return; clearTimeout(disconnectTimer); if(connected){connectedOnce=true;connectionBanner.classList.add('hidden');return;} if(!connectedOnce||intentionalLogout){connectionBanner.classList.add('hidden');return;} disconnectTimer=setTimeout(()=>{if(!socket.connected&&!intentionalLogout)connectionBanner.classList.remove('hidden');},1800); };
        socket.on('disconnect', reason => {
            if (intentionalLogout) { setConnected(true); return; }
            if (currentUser && ['transport close', 'transport error', 'ping timeout'].includes(reason)) {
                localDB = null; pendingOK = null;
                document.getElementById('btn-ok').disabled = true;
                document.getElementById('btn-help').disabled = true;
                document.getElementById('tv-break-overlay').classList.add('hidden');
                setConnected(false);
                return;
            }
            const error = currentUser ? 'Połączenie zostało przerwane. Zaloguj się ponownie po jego przywróceniu.' : document.getElementById('l-msg').innerText;
            resetSession(error); setConnected(false);
        });
        socket.on('connect_error', error => {
            if (intentionalLogout) return;
            setConnected(false);
            if (error.data?.code) {
                resetSession('Sesja wygasła lub dostęp został zmieniony. Zaloguj się ponownie.');
                socket.disconnect();
            }
        });
        const reconnect = () => { if (currentUser && !socket.connected && socket.active) socket.connect(); };
        window.addEventListener('online', reconnect);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) reconnect(); });
        socket.on('serviceError',result=>showNotification('error','Błąd serwera',result.error));
        setConnected(true);

        socket.on('sync', (serverState) => {
            if (!currentUser) return;
            if (currentUser !== 'tv') {
                if (operatorCycleId && operatorCycleId !== serverState.cycleId) {
                    okAvailableAt = performance.now() + OK_COOLDOWN_MS;
                    clearTimeout(okCooldownTimer);
                    okCooldownTimer = setTimeout(() => Render.all(), OK_COOLDOWN_MS);
                }
                operatorCycleId = serverState.cycleId;
                if (pendingOK && (pendingOK.cycleId !== serverState.cycleId || serverState.st[currentUser]?.r)) pendingOK = null;
            }
            localDB = serverState;
            setConnected(true);
            Render.all();
            if(currentUser==='tv')SupportSound.sync(serverState);
        });

        document.addEventListener('DOMContentLoaded', () => {
            const wrapper = document.getElementById('custom-station-select');
            const trigger = wrapper.querySelector('.custom-select-trigger');
            const options = wrapper.querySelectorAll('.custom-option');
            const hiddenInput = document.getElementById('station-select');
            const triggerContent = trigger.querySelector('.trigger-content');

            const setSelectOpen = open => { wrapper.classList.toggle('open', open); trigger.setAttribute('aria-expanded', String(open)); };
            trigger.addEventListener('click', () => setSelectOpen(!wrapper.classList.contains('open')));
            trigger.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectOpen(!wrapper.classList.contains('open')); }
                if (e.key === 'Escape') { e.preventDefault(); setSelectOpen(false); }
                if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && options.length) { e.preventDefault(); setSelectOpen(true); const i = [...options].findIndex(o => o.classList.contains('selected')); options[e.key === 'ArrowDown' ? Math.min(options.length - 1, i + 1) : Math.max(0, i - 1)].focus(); }
            });

            options.forEach((option, index) => {
                option.addEventListener('keydown', e => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); option.click(); }
                    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault(); options[Math.max(0, Math.min(options.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))].focus();
                    } else if (e.key === 'Home' || e.key === 'End') {
                        e.preventDefault(); options[e.key === 'Home' ? 0 : options.length - 1].focus();
                    } else if (e.key === 'Escape' || e.key === 'ArrowLeft') {
                        e.preventDefault(); setSelectOpen(false); trigger.focus();
                    } else if (e.key === 'Tab') setSelectOpen(false);
                });
                option.addEventListener('click', () => {
                    const value = option.getAttribute('data-value');
                    const title = option.querySelector('.opt-title').innerText;
                    const icon = option.querySelector('.opt-icon').innerText;
                    const iconStyle = option.querySelector('.opt-icon').getAttribute('style') || '';
                    
                    hiddenInput.value = value;
                    triggerContent.replaceChildren(); const iconNode=document.createElement('i');iconNode.className='material-icons opt-icon';iconNode.textContent=icon;const titleNode=document.createElement('span');titleNode.textContent=title;triggerContent.append(iconNode,titleNode);
                    
                    options.forEach(opt => { opt.classList.remove('selected'); opt.setAttribute('aria-selected', 'false'); });
                    option.classList.add('selected'); option.setAttribute('aria-selected', 'true');
                    setSelectOpen(false); trigger.focus();
                });
            });

            const loginControls = [trigger, document.getElementById('password-input'), document.querySelector('[data-auth-login]')];
            loginControls.forEach((control, index) => control.addEventListener('keydown', e => {
                if (wrapper.classList.contains('open') || !['ArrowDown', 'ArrowUp'].includes(e.key)) return;
                e.preventDefault(); loginControls[Math.max(0, Math.min(loginControls.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))].focus();
            }));

            document.addEventListener('click', (e) => {
                if (!wrapper.contains(e.target)) setSelectOpen(false);
            });
        });

function setTheme(theme) {
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('theme', theme);

            // --- NOWOŚĆ: Automatyczna podmiana logo zależnie od motywu ---
            // Jeśli motyw to 'light' ładujemy logo.png, w przeciwnym razie logo2.png (białe)
            const logoPath = (theme === 'light') ? 'logo.png' : 'logo2.png';
            
            // 1. Zmiana loga na ekranie logowania
            const loginLogo = document.querySelector('.login-logo');
            if (loginLogo) loginLogo.src = logoPath;
            
            // 2. Zmiana głównego loga w prawym górnym rogu (po zalogowaniu)
            const globalLogo = document.getElementById('global-logo');
            if (globalLogo) globalLogo.src = logoPath;
            
        }

        // WYMUSZENIE POPRAWNEGO LOGA OD RAZU PO ZAŁADOWANIU STRONY
        const initialTheme = localStorage.getItem('theme') || 'dark';
        setTheme(initialTheme);

        const departmentStations={electro:[...AndonStations.departments.electro,'tv'],assembly:[...AndonStations.departments.assembly,'tv-assembly']};
        const stationOptions=document.getElementById('station-options'),stationInput=document.getElementById('station-select'),stationGroup=document.getElementById('station-group'),secondToggle=document.getElementById('second-operator-toggle'),secondGroup=document.getElementById('second-operator-group');
        const stationIcon=id=>(id==='tv'||id.startsWith('tv-'))?'tv':'precision_manufacturing';
        const stationTitle=id=>(id==='tv'||id.startsWith('tv-'))?'Dashboard '+(id==='tv'?'Elektromontażu':'Montażu'):'Stanowisko '+AndonStations.label(id);
        function updateSecondOperator(){const available=currentDepartment==='assembly'&&AndonStations.supportsSecond(stationInput.value);secondToggle.classList.toggle('hidden',!available||!secondGroup.classList.contains('hidden'));if(!available){secondGroup.classList.add('hidden');document.getElementById('second-password-input').value='';}}
        function chooseStation(id,option){stationInput.value=id;document.querySelector('#custom-station-select .trigger-content span').textContent=stationTitle(id);document.querySelector('#custom-station-select .trigger-content i').textContent=stationIcon(id);stationOptions.querySelectorAll('.custom-option').forEach(el=>{el.classList.toggle('selected',el===option);el.setAttribute('aria-selected',String(el===option));});document.getElementById('custom-station-select').classList.remove('open');updateSecondOperator();}
        function buildStations(department){currentDepartment=department;document.querySelectorAll('[data-department]').forEach(button=>button.classList.toggle('active',button.dataset.department===department));const management=department==='management';stationGroup.classList.toggle('hidden',management);secondToggle.classList.add('hidden');secondGroup.classList.add('hidden');if(management){stationInput.value='panel';document.getElementById('password-input').focus();return;}stationOptions.replaceChildren(...departmentStations[department].map((id,index)=>{const option=document.createElement('div');option.className='custom-option'+(index===0?' selected':'');option.role='option';option.tabIndex=-1;option.dataset.value=id;option.setAttribute('aria-selected',String(index===0));option.innerHTML=`<i class="material-icons opt-icon">${stationIcon(id)}</i><div class="opt-text"><span class="opt-title">${stationTitle(id)}</span><span class="opt-sub">${(id==='tv'||id.startsWith('tv-'))?'Ekran informacyjny':department==='electro'?'Elektromontaż':'Montaż'}</span></div>`;option.addEventListener('click',()=>chooseStation(id,option));return option;}));const first=departmentStations[department][0];chooseStation(first,stationOptions.firstElementChild);}
        document.querySelectorAll('[data-department]').forEach(button=>button.addEventListener('click',()=>buildStations(button.dataset.department)));
        secondToggle.addEventListener('click',()=>{secondToggle.classList.add('hidden');secondGroup.classList.remove('hidden');document.getElementById('second-password-input').focus();});
        document.getElementById('second-operator-remove').addEventListener('click',()=>{document.getElementById('second-password-input').value='';secondGroup.classList.add('hidden');updateSecondOperator();});
        buildStations('electro');

        document.getElementById('password-input').addEventListener('keypress', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); Auth.login(); }
        });

        let toastTimer;
        function showNotification(type, title, message) {
            const toast = document.getElementById('teams-toast');
            toast.className = type || '';
            document.getElementById('toast-icon').innerText = type === 'error' ? 'error' : 'check_circle';
            document.getElementById('toast-title').innerText = title;
            document.getElementById('toast-message').innerText = message || '';
            requestAnimationFrame(() => toast.classList.add('show'));
            clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 5000);
        }

        function switchLogTab(tab) {
            const tabs = document.querySelectorAll('.btn-tab');
            tabs[0].classList.toggle('active', tab === 'general');
            tabs[1].classList.toggle('active', tab === 'cycles');
            
            document.getElementById('tv-logs').classList.toggle('hidden', tab !== 'general');
            document.getElementById('tv-cycle-logs').classList.toggle('hidden', tab !== 'cycles');
        }

        const Auth = {
            login: async () => {
                if (loginPending) return;
                loginPending = true;
                const station=document.getElementById('station-select').value;
                const input=document.getElementById('password-input'),code=input.value.trim();input.value='';
                const err=document.getElementById('l-msg');err.innerText='';
                const button=document.querySelector('[data-event-click="0"]');if(button)button.disabled=true;
                try {
                    const result=await AndonAuth.login(code);
                    if(currentDepartment==='management'){
                        if(!['owner','manager'].includes(result.role))throw new Error('Brak uprawnień do panelu sterowania.');
                        history.replaceState({returnHome:true},'',location.href);location.replace(panelPath);return;
                    }
                    currentUser=station;currentUserName=result.userName;secondOperatorName=null;
                    const secondInput=document.getElementById('second-password-input');
                    const secondCode=secondInput?secondInput.value.trim():'';
                    if(secondCode){if(secondCode===code)throw new Error('Drugi operator musi użyć innej karty.');const second=await AndonAuth.verifyOperator(secondCode);secondOperatorName=second.userName;}
                    if(station==='tv'||station.startsWith('tv-'))UI.switch('view-tv');
                    else{document.getElementById('op-title').innerText=AndonStations.label(station);document.getElementById('op-user-name').innerText=[currentUserName,secondOperatorName].filter(Boolean).join(' + ');UI.switch('view-op');}
                    await AndonAuth.connect(socket,station);
                } catch(error){resetSession(error.message);}
                finally{loginPending=false;if(button)button.disabled=false;}
            },
            logout: async()=>{
                if(intentionalLogout)return;
                intentionalLogout=true;
                SupportSound.reset();setConnected(true);
                if(connectionBanner)connectionBanner.classList.add('hidden');
                document.querySelectorAll('.modal-overlay.show').forEach(modal=>modal.classList.remove('show'));
                const loginButton=document.querySelector('[data-auth-login]');if(loginButton)loginButton.disabled=true;
                try{await AndonAuth.logout();}catch{}finally{
                    socket.disconnect();resetSession();history.replaceState(null,'','/');
                    intentionalLogout=false;if(loginButton)loginButton.disabled=false;
                }
            }
        };

        const Logic = {
            actionOK: () => {
                if (!requireConnection()) return;
                if (pendingOK || performance.now() < okAvailableAt || localDB.count >= localDB.goal || !localDB.shiftActive || localDB.isBreak || localDB.st[currentUser]?.r) return;
                const operation = {cycleId:localDB.cycleId,requestId:AndonAuth.requestId()};
                pendingOK = operation;
                const btn = document.getElementById('btn-ok');
                if (btn) btn.disabled = true;
                Render.all();
                socket.timeout(10000).emit('actionOK', operation, (error,result)=>{
                    if (pendingOK !== operation) return;
                    if(error||!result||!result.ok){pendingOK=null;showNotification('error','Nie potwierdzono operacji',error?'Brak odpowiedzi serwera.':result?.error || 'Spróbuj ponownie.');}
                    Render.all();
                });
            },
            handleSupportClick: () => {
                if (!requireConnection()) return;
                if (localDB && localDB.st[currentUser] && localDB.st[currentUser].s) {
                    Logic.cancelSupport();
                } else {
                    document.getElementById('support-comment-container').classList.add('hidden');
                    document.getElementById('support-comment').value = '';
                    modals.open('support');
                }
            },
            showMaterialComment: () => {
                document.getElementById('support-comment-container').classList.remove('hidden');
            },
            callSupport: (reason, isMaterialShortage = false) => {
                if (!requireConnection()) return;
                let comment = isMaterialShortage ? document.getElementById('support-comment').value.trim() : '';
                socket.timeout(10000).emit('callSupport', { reason, comment, requestId:AndonAuth.requestId() }, (error, result) => {
                    if (!error && result && result.ok) { Logic.closeSupportModal(); showNotification('success', 'Zgłoszenie wysłane', 'Zgłoszenie zapisano. Powiadomienie zewnętrzne oczekuje na wysłanie.'); }
                    else showNotification('error', 'Nie wysłano zgłoszenia', result && result.error ? result.error : 'Spróbuj ponownie lub zawiadom brygadzistę osobiście.');
                });
            },
            closeSupportModal: () => {
                document.getElementById('support-comment').value = ''; 
                document.getElementById('support-comment-container').classList.add('hidden');
                modals.close('support');
            },
            cancelSupport: () => {
                if (!requireConnection()) return;
                socket.timeout(10000).emit('cancelSupport', {requestId:AndonAuth.requestId()}, (error, result) => { if (error || !result || !result.ok) showNotification('error', 'Nie anulowano wezwania', result && result.error ? result.error : 'Spróbuj ponownie.'); });
            },

        };

        function requireConnection() {
            if (currentUser && socket.connected && localDB) return true;
            showNotification('error', 'Trwa ponowne łączenie', 'Poczekaj na aktualne dane z serwera.');
            return false;
        }

        const Render = {
            all: () => {
                const db = localDB; 
                if (!db) return; 

                const bStat=db.breakInfo||{active:false};
                const tSec=db.remainingSec||0,dSec=db.downSec||0;
                if(!document.getElementById('view-tv').classList.contains('hidden')) Render.tv(db, tSec, bStat);
                if(!document.getElementById('view-op').classList.contains('hidden')) Render.op(db, tSec, dSec);
            },
            tv: (db, tSec, bStat) => {
                document.getElementById('sys-clock').innerText = new Date(db.serverTime).toLocaleTimeString('pl-PL', {hour: '2-digit', minute:'2-digit', timeZone: 'Europe/Warsaw'});
                document.getElementById('tv-takt').innerText = fmt(tSec);
                document.getElementById('tv-goal-lbl').innerText = `Realizacja (Cel: ${db.goal})`;
                document.getElementById('tv-count').innerText = `${db.count}/${db.goal}`;
                
                const overlay = document.getElementById('tv-break-overlay');
                if(bStat.active && db.shiftActive && currentUser === 'tv' && !db.breakOverlayDisabled) {
                    overlay.classList.remove('hidden');
                    document.getElementById('overlay-title').innerText = bStat.name;
                    document.getElementById('overlay-icon').innerText = bStat.icon;
                    document.getElementById('break-timer').innerText = fmt(bStat.left);
                } else {
                    overlay.classList.add('hidden');
                }

                const st = document.getElementById('tv-status');
                if(db.count>=db.goal) { st.innerText = 'CEL OSIĄGNIĘTY'; st.style.color = 'var(--status-ok)'; }
                else if(!db.shiftActive) { st.innerText = db.shiftStart ? "ZATRZYMANA" : "OCZEKIWANIE"; st.style.color = "var(--col-muted)"; }
                else if(db.isDown) { st.innerText = "PRZESTÓJ"; st.style.color = "var(--status-nok)"; }
                else { st.innerText = "PRACA"; st.style.color = "var(--status-ok)"; }

                const g=document.getElementById('tv-grid');
                const dashboardStations=Object.keys(db.st||{});
                const dashboardSignature=dashboardStations.join('|');
                if(g.dataset.stations!==dashboardSignature){
                    g.dataset.stations=dashboardSignature;
                    g.innerHTML=dashboardStations.map(id=>`<div class="tv-card" id="card-${id}"><div class="tv-card-head">${AndonStations.label(id)}</div><div class="tv-card-sub" id="sub-${id}">W TOKU</div></div>`).join('');
                    g.classList.toggle('assembly-dashboard',dashboardStations.some(id=>AndonStations.department(id)==='assembly'));
                    const heading=document.querySelector('#view-tv .title-main');
                    if(heading)heading.childNodes[0].textContent=dashboardStations.some(id=>AndonStations.department(id)==='assembly')?'DASHBOARD MONTAŻU ':'DASHBOARD ELEKTROMONTAŻU ';
                }
                dashboardStations.forEach(id => {
                    const s = db.st[id]; if(!s)return; const card = document.getElementById(`card-${id}`); const sub = document.getElementById(`sub-${id}`);
                    card.className = 'tv-card'; 
                    if(s.s) { card.classList.add('st-warn'); sub.innerText = s.reason || 'WSPARCIE'; } 
                    else if(db.isDown && !s.r) { card.classList.add('st-err'); sub.innerText = 'OPÓŹNIENIE'; }
                    else if(s.r) { card.classList.add('st-ok'); sub.innerText = 'ZROBIONE'; }
                    else { sub.innerText = 'W TOKU'; }
                });

                const newLogsHTML = db.logs.map(l => `<div class="log-item ${l.type === 'alert' ? 'alert' : ''}"><span class="log-time">${escapeHTML(l.t)}</span> <span class="log-title">${escapeHTML(l.m)}</span>${l.d ? `<span class="log-detail">${escapeHTML(l.d)}</span>` : ''}</div>`).join('');
                const logContainer = document.getElementById('tv-logs');
                if (logContainer.innerHTML !== newLogsHTML) logContainer.innerHTML = newLogsHTML;

                if (db.cycleTimes) {
                    const cycleHTML = db.cycleTimes.map(c => `<div class="log-item" data-cycle="true"><span class="log-time">${escapeHTML(c.ts)}</span> <span class="log-title">${escapeHTML(AndonStations.label(c.s))} / Takt ${escapeHTML(c.t)} / <span class="cycle-value">${escapeHTML(c.m)}</span></span></div>`).join('');
                    const cycleContainer = document.getElementById('tv-cycle-logs');
                    if (cycleContainer.innerHTML !== cycleHTML) cycleContainer.innerHTML = cycleHTML;
                }
            },
            op: (db, tSec, dSec) => {
                document.getElementById('op-takt').innerText = fmt(tSec);
                document.getElementById('op-down').innerText = fmt(dSec);
                document.getElementById('op-goal-lbl').innerText = `Wykonano (Cel: ${db.goal})`;
                document.getElementById('op-count').innerText = `${db.count}/${db.goal}`;
                
                const s = db.st[currentUser]; if(!s)return;
                const bOk = document.getElementById('btn-ok'); const bSup = document.getElementById('btn-help');bSup.disabled=s.s&&!s.canCancel;
                
                if(db.count>=db.goal) {
                    bOk.innerHTML = `CEL OSIĄGNIĘTY<div class='btn-sub'>Plan wykonany. Poczekaj na nową zmianę.</div>`; bOk.disabled = true;
                } else if(!db.shiftActive) {
                    bOk.innerHTML = `ZMIANA ZATRZYMANA<div class='btn-sub'>Poczekaj na rozpoczęcie zmiany</div>`; bOk.disabled = true;
                } else if(db.isBreak) {
                    bOk.innerHTML = `PRZERWA<div class='btn-sub'>Odpocznij, czas jest zatrzymany</div>`; bOk.disabled = true;
                } else if(s.r) {
                    bOk.innerHTML = `OCZEKIWANIE...<div class='btn-sub'>Czekamy na zamknięcie cyklu na linii</div>`; bOk.disabled = true;
                } else if(pendingOK || performance.now() < okAvailableAt) {
                    bOk.innerHTML = `POTWIERDŹ OK<div class='btn-sub'>${pendingOK ? 'Zapisywanie potwierdzenia…' : 'Nowy cykl — poczekaj chwilę'}</div>`; bOk.disabled = true;
                } else { 
                    bOk.innerHTML = `POTWIERDŹ OK<div class='btn-sub'>Zakończ cykl jako prawidłowy</div>`; bOk.disabled = false; 
                }

                if(s.s) { bSup.classList.add('active'); bSup.innerHTML = `<i class='material-icons'>close</i>Anuluj Wsparcie<div class='btn-sub'>Zgłoszono: ${escapeHTML(s.reason)}</div>`; }
                else { bSup.classList.remove('active'); bSup.innerHTML = `<i class='material-icons'>support_agent</i>Wezwij Wsparcie`; }
            },

        };

        const UI = { switch: (id) => { document.body.classList.toggle('role-tv', id === 'view-tv'); document.querySelectorAll('body > div.hidden, body > div[id^="view-"]').forEach(d => d.classList.add('hidden')); document.getElementById(id).classList.remove('hidden'); Render.all(); } };
        function resetSession(error = '') {
            pendingOK = null; operatorCycleId = null; okAvailableAt = 0; clearTimeout(okCooldownTimer);
            SupportSound.reset(); currentUser = null; currentUserName = null; localDB = null;
            document.querySelectorAll('.modal-overlay').forEach(modal => modal.classList.remove('show'));
            document.getElementById('modal-op-settings').inert = true;
            optionsTrigger = null;
            Logic.closeSupportModal();
            if (Dialog._resolve) Dialog._close(false);
            document.getElementById('tv-sidebar').classList.remove('open');
            clearTimeout(toastTimer);
            document.getElementById('teams-toast').classList.remove('show');
            document.getElementById('password-input').value = '';
            document.getElementById('op-user-name').innerText = '';
            UI.switch('view-login');
            document.getElementById('l-msg').innerText = error;
            document.getElementById('password-input').focus();
        }
        let optionsTrigger=null;
        const modals = {
            open: id => {
                const modal=document.getElementById('modal-'+id);
                if(id==='op-settings'){
                    optionsTrigger=document.activeElement;
                    document.getElementById('dashboard-sound-options').hidden=currentUser!=='tv';
                    modal.inert=false;
                }
                modal.classList.add('show');
                if(id==='op-settings')modal.querySelector('button').focus();
            },
            close: id => {
                const modal=document.getElementById('modal-'+id);modal.classList.remove('show');
                if(id==='op-settings'){modal.inert=true;optionsTrigger?.focus();}
            }
        };

        // NOWOŚĆ: ostylowane okno dialogowe (zamiast natywnych confirm/alert). Zwraca Promise<boolean>.
        const Dialog = {
            _resolve: null,
            _onKey: null,
            show: (message, opts) => {
                opts = opts || {};
                return new Promise((resolve) => {
                    Dialog._resolve = resolve;
                    document.getElementById('dialog-title').innerText = opts.title || 'Potwierdzenie';
                    document.getElementById('dialog-msg').innerText = message;
                    const ok = document.getElementById('dialog-ok');
                    const cancel = document.getElementById('dialog-cancel');
                    ok.innerText = opts.okText || (opts.alert ? 'OK' : 'Potwierdź');
                    ok.className = 'btn-action ' + (opts.danger ? 'danger' : 'primary');
                    cancel.style.display = opts.alert ? 'none' : '';
                    document.getElementById('modal-dialog').classList.add('show');
                    setTimeout(() => { try { ok.focus(); } catch (e) {} }, 50);
                    Dialog._onKey = (e) => {
                        if (e.key === 'Escape') { e.preventDefault(); Dialog._close(false); }
                        else if (e.key === 'Enter') { e.preventDefault(); Dialog._close(true); }
                    };
                    document.addEventListener('keydown', Dialog._onKey);
                });
            },
            confirm: (message, opts) => Dialog.show(message, opts || {}),
            alert: (message, opts) => Dialog.show(message, Object.assign({ alert: true }, opts || {})),
            _close: (result) => {
                document.getElementById('modal-dialog').classList.remove('show');
                if (Dialog._onKey) { document.removeEventListener('keydown', Dialog._onKey); Dialog._onKey = null; }
                const r = Dialog._resolve; Dialog._resolve = null;
                if (r) r(result);
            }
        };
        function fmt(s) { return `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`; }
        function fmtHMS(s) { const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), x = s%60; return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${x.toString().padStart(2,'0')}`; }

        // ===== Eksport pomiarów do .xlsx — czysty JS, bez bibliotek, działa offline =====
        // Buduje prawidłowy plik OOXML jako nieskompresowany ZIP (metoda "stored") + CRC32.
        setInterval(() => { if(!document.getElementById('view-login').classList.contains('show') && document.getElementById('view-login').classList.contains('hidden')) Render.all(); }, 1000);
    
        // NOWOŚĆ: Logika trybu pełnoekranowego (Fullscreen API)
        function toggleFullScreen() {
            if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(err => console.error(`Błąd próby włączenia pełnego ekranu: ${err.message}`));
            else if (document.exitFullscreen) document.exitFullscreen();
        }
        document.addEventListener('fullscreenchange', () => { const icon = document.getElementById('fs-icon'); if (icon) icon.innerText = document.fullscreenElement ? 'fullscreen_exit' : 'fullscreen'; });

    
    
document.querySelectorAll('[data-event-click="0"]').forEach(el=>el.addEventListener('click',function(event){Auth.login()}));

document.querySelectorAll('[data-event-click="1"]').forEach(el=>el.addEventListener('click',function(event){toggleFullScreen()}));

document.querySelectorAll('[data-event-click="2"]').forEach(el=>el.addEventListener('click',function(event){Auth.logout()}));

document.querySelectorAll('[data-event-click="3"]').forEach(el=>el.addEventListener('click',function(event){document.getElementById('tv-sidebar').classList.add('open')}));

document.querySelectorAll('[data-event-click="4"]').forEach(el=>el.addEventListener('click',function(event){document.getElementById('tv-sidebar').classList.remove('open')}));

document.querySelectorAll('[data-event-click="5"]').forEach(el=>el.addEventListener('click',function(event){switchLogTab('general')}));

document.querySelectorAll('[data-event-click="6"]').forEach(el=>el.addEventListener('click',function(event){switchLogTab('cycles')}));

document.querySelectorAll('[data-event-click="7"]').forEach(el=>el.addEventListener('click',function(event){modals.open('op-settings')}));

document.querySelectorAll('[data-event-mouseover="8"]').forEach(el=>el.addEventListener('mouseover',function(event){this.style.color='var(--col-text)'}));

document.querySelectorAll('[data-event-mouseout="9"]').forEach(el=>el.addEventListener('mouseout',function(event){this.style.color='var(--col-muted)'}));

document.querySelectorAll('[data-event-click="10"]').forEach(el=>el.addEventListener('click',function(event){Auth.logout()}));

document.querySelectorAll('[data-event-click="11"]').forEach(el=>el.addEventListener('click',function(event){Logic.actionOK()}));

document.querySelectorAll('[data-event-click="12"]').forEach(el=>el.addEventListener('click',function(event){Logic.handleSupportClick()}));

document.querySelectorAll('[data-event-click="13"]').forEach(el=>el.addEventListener('click',function(event){modals.open('doc')}));

document.querySelectorAll('[data-event-click="14"]').forEach(el=>el.addEventListener('click',function(event){setTheme('dark')}));

document.querySelectorAll('[data-event-click="15"]').forEach(el=>el.addEventListener('click',function(event){setTheme('light')}));

document.querySelectorAll('[data-event-click="16"]').forEach(el=>el.addEventListener('click',function(event){modals.close('op-settings')}));

document.querySelectorAll('[data-event-click="17"]').forEach(el=>el.addEventListener('click',function(event){Logic.showMaterialComment()}));

document.querySelectorAll('[data-event-click="18"]').forEach(el=>el.addEventListener('click',function(event){Logic.callSupport('Awaria Maszyny')}));

document.querySelectorAll('[data-event-click="19"]').forEach(el=>el.addEventListener('click',function(event){Logic.callSupport('Wada materiału')}));

document.querySelectorAll('[data-event-click="20"]').forEach(el=>el.addEventListener('click',function(event){Logic.callSupport('Inne / Brygadzista')}));

document.querySelectorAll('[data-event-click="21"]').forEach(el=>el.addEventListener('click',function(event){Logic.callSupport('Brak Materiału', true)}));

document.querySelectorAll('[data-event-click="22"]').forEach(el=>el.addEventListener('click',function(event){Logic.closeSupportModal()}));

document.querySelectorAll('[data-event-click="23"]').forEach(el=>el.addEventListener('click',function(event){modals.close('doc')}));

document.querySelectorAll('[data-event-click="24"]').forEach(el=>el.addEventListener('click',function(event){if(event.target===this) Dialog._close(false)}));

document.querySelectorAll('[data-event-click="25"]').forEach(el=>el.addEventListener('click',function(event){Dialog._close(true)}));

document.querySelectorAll('[data-event-click="26"]').forEach(el=>el.addEventListener('click',function(event){Dialog._close(false)}));


document.getElementById('dashboard-options').addEventListener('click',()=>modals.open('op-settings'));
document.getElementById('modal-op-settings').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();modals.close('op-settings');}});
