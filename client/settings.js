
        const params = new URLSearchParams(location.search);
        if (params.get('err')) document.getElementById('err').textContent = params.get('err');
        window.andon.getServer().then(u => { if (u) document.getElementById('url').value = u; });
        function submit() {
            const v = document.getElementById('url').value;
            window.andon.saveServer(v).then(r => {
                if (r && !r.ok) document.getElementById('err').textContent = r.error || 'Błąd.';
            });
        }
        document.getElementById('go').addEventListener('click', submit);
        document.getElementById('url').addEventListener('keypress', e => { if (e.key === 'Enter') submit(); });
    