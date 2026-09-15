'use strict';
const AndonAuth = (() => {
    let csrfToken = null;
    async function http(url, body) {
        const response = await fetch(url, { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: body ? {'Content-Type':'application/json','X-CSRF-Token':csrfToken||''}: {}, ...(body?{body:JSON.stringify(body)}:{}), signal:AbortSignal.timeout(15000) });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || 'Nie udało się wykonać operacji.');
        if (result.csrfToken) csrfToken = result.csrfToken;
        return result;
    }
    let preparePromise = null;
    function prepare() {
        if (!preparePromise) preparePromise = http('/api/session').catch(error => { preparePromise = null; throw error; });
        return preparePromise;
    }
    async function login(code) { await prepare(); return http('/api/login',{code}); }
    async function verifyOperator(code) { return http('/api/co-login',{code}); }
    async function connect(socket, view) {
        socket.auth={view,csrfToken};
        await new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>finish(new Error('Serwer nie odpowiedział.')),10000);
            const success=()=>finish(); const failure=()=>finish(new Error('Brak uprawnień do wybranego widoku lub sesja wygasła.'));
            function finish(error){clearTimeout(timer);socket.off('connect',success);socket.off('connect_error',failure);if(error){socket.disconnect();reject(error);}else resolve();}
            socket.once('connect',success);socket.once('connect_error',failure);socket.connect();
        });
    }
    async function logout(){try{if(csrfToken)await http('/api/logout',{});}finally{csrfToken=null;}}
    const requestId=()=>crypto.randomUUID();
    prepare().catch(() => {});
    return {login,verifyOperator,connect,logout,requestId,prepare};
})();
