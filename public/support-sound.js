'use strict';
const SupportSound = (() => {
    let audio = null, enabled = false, busy = false, generation = 0, previous = null;
    let context = null, toneVolume = null, fallback = false;
    const tones = new Set();
    let volume=1;
    try{const saved=localStorage.getItem('andon-sound-volume');if(saved!==null&&Number.isFinite(Number(saved)))volume=Math.max(0,Math.min(1,Number(saved)));}catch{}
    const buttons = () => document.querySelectorAll('[data-sound-test]');
    function status(text) {
        document.querySelectorAll('[data-sound-status]').forEach(el => { el.textContent = text; });
        buttons().forEach(el => { el.textContent = enabled ? 'Sprawdź dźwięk' : 'Włącz i sprawdź dźwięk'; el.disabled = busy; });
        document.querySelectorAll('[data-sound-mute]').forEach(el => { el.disabled = !enabled && !busy; });
    }
    function failure(error) {
        generation++; enabled = false; busy = false;
        status(error?.name === 'NotAllowedError'
            ? 'Przeglądarka zablokowała dźwięk. Kliknij „Włącz i sprawdź dźwięk”.'
            : 'Nie udało się odtworzyć dźwięku. Sprawdź połączenie i ponów test.');
    }
    function prepareTone() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return Promise.resolve();
            if (!context) {
                context = new AudioContext(); toneVolume = context.createGain();
                toneVolume.connect(context.destination);
            }
            // Odblokowanie także sygnału awaryjnego następuje przy kliknięciu testu.
            return Promise.resolve(context.resume()).catch(() => {});
        } catch { return Promise.resolve(); }
    }
    function stopTones() {
        for (const oscillator of tones) { try { oscillator.stop(); } catch {} }
        tones.clear();
        if (toneVolume) toneVolume.gain.value = 0;
    }
    function playTone(token) {
        if (token !== generation || !context || context.state !== 'running') return false;
        try {
            stopTones(); fallback = true;
            if (audio) audio.pause();
            toneVolume.gain.value = volume;
            for (const [index, delay] of [0, .35, .7].entries()) {
                const oscillator = context.createOscillator(), envelope = context.createGain(), at = context.currentTime + delay;
                oscillator.type = 'sine'; oscillator.frequency.value = index === 1 ? 880 : 660;
                envelope.gain.setValueAtTime(.0001, at);
                envelope.gain.exponentialRampToValueAtTime(.25, at + .02);
                envelope.gain.exponentialRampToValueAtTime(.0001, at + .24);
                oscillator.connect(envelope); envelope.connect(toneVolume); tones.add(oscillator);
                oscillator.onended = () => { tones.delete(oscillator); oscillator.disconnect(); envelope.disconnect(); };
                oscillator.start(at); oscillator.stop(at + .26);
            }
            enabled = true; busy = false;
            status('Sygnał awaryjny aktywny — plik MP3 jest niedostępny. Kliknij test, aby spróbować MP3 ponownie.');
            return true;
        } catch { stopTones(); fallback = false; return false; }
    }
    async function play(test = false) {
        if (busy || (!test && !enabled)) return;
        const token = ++generation; busy = true; status('Uruchamianie dźwięku…');
        const prepared = test ? prepareTone() : Promise.resolve();
        if (!test && fallback && playTone(token)) return;
        try {
            if (!audio) {
                audio = new Audio('/wssong.mp3?v=20260913-2');
                audio.preload = 'auto'; audio.loop = false;
                audio.addEventListener('error', () => { if (enabled && !busy && !fallback && !playTone(generation)) failure(); });
            }
            if (test && audio.error) audio.load();
            audio.muted = false; audio.volume = volume; audio.currentTime = 0;
            // play() musi zostać wywołane bezpośrednio w obsłudze kliknięcia, przed await.
            const started = audio.play();
            await started;
            if (token !== generation) return;
            stopTones(); fallback = false; enabled = true; busy = false;
            status('Dźwięk aktywny na tym urządzeniu. Jeśli testu nie słychać, sprawdź głośniki i wyciszenie karty.');
        } catch (error) { await prepared; if (token === generation && !playTone(token)) failure(error); }
    }
    function mute() {
        generation++; enabled = false; busy = false;
        stopTones(); fallback = false;
        if (audio) { audio.pause(); audio.currentTime = 0; }
        status('Dźwięk wyłączony na tym urządzeniu. Wezwania pozostają widoczne na ekranie.');
    }
    function sync(state) {
        const next = Object.fromEntries(Object.entries(state?.st || {}).map(([id,s]) => [id,Boolean(s.s)]));
        const fresh = previous && Object.keys(next).some(id => next[id] && previous[id] === false);
        previous = next;
        // Pierwsza synchronizacja przedstawia istniejące wezwania, nie nowe zdarzenia.
        if (fresh) void play();
    }
    function reset() { previous = null; mute(); }
    buttons().forEach(el => el.addEventListener('click', () => { void play(true); }));
    document.querySelectorAll('[data-sound-mute]').forEach(el => el.addEventListener('click', mute));
    function renderVolume(){
        document.querySelectorAll('[data-sound-volume]').forEach(el=>{el.value=String(Math.round(volume*100));el.setAttribute('aria-valuetext',Math.round(volume*100)+'%');});
        document.querySelectorAll('[data-sound-volume-value]').forEach(el=>{el.textContent=Math.round(volume*100)+'%';});
    }
    document.querySelectorAll('[data-sound-volume]').forEach(el=>el.addEventListener('input',()=>{
        const next=Number(el.value);if(!Number.isFinite(next))return;
        volume=Math.max(0,Math.min(1,next/100));if(audio)audio.volume=volume;if(toneVolume)toneVolume.gain.value=volume;
        try{localStorage.setItem('andon-sound-volume',String(volume));}catch{}
        renderVolume();
    }));
    renderVolume();
    status('Włącz dźwięk i wykonaj test na tym urządzeniu.');
    return {sync,reset};
})();
