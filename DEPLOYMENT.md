# Andon — wdrożenie On-Premise (zero-config `.exe`)

Instrukcja wdrożenia systemu Andon w zamkniętej sieci lokalnej, na stacjach **bez zainstalowanego Node.js i bez uprawnień administratora**.

## 1. Architektura wdrożenia

- Aplikacja jest pakowana do **jednego pliku `andon.exe`** z wbudowanym runtime Node.js (narzędzie `@yao-pkg/pkg`). Na maszynie docelowej **nie trzeba instalować Node.js** — kopiujesz jeden plik i uruchamiasz.
- Serwer w produkcji nasłuchuje na **porcie 80** (standardowy HTTP). Dzięki temu ruch (w tym WebSocket, który działa jako HTTP `Upgrade` na tym samym porcie) nie jest blokowany przez reguły zapory dla „niestandardowych portów". Klienci łączą się przez `http://<serwer>/` — bez `:3000`.
- Role maszyn:
  - **Maszyna budująca** — jednorazowo, z Node.js + internetem: tu powstaje `.exe`.
  - **Stacja-serwer** — uruchamia `andon.exe` (jedna w sieci).
  - **Stacje klienckie** (operatorzy, TV, brygadzista) — tylko przeglądarka.

## 2. Budowanie `andon.exe` (maszyna budująca)

Wymagania: Node.js LTS (≥ 18) oraz dostęp do internetu (pkg jednorazowo pobiera bazowy runtime, ~30–40 MB).

```powershell
# w katalogu projektu
npm install
npm i -D @yao-pkg/pkg      # instaluje aktualną wersję narzędzia pakującego
npm run build              # uruchamia: pkg .
```

Wynik: **`dist\andon.exe`** — samodzielny plik zawierający runtime, kod i zasoby statyczne (`public/`, klient `socket.io`).

Uwagi:
- Cel budowania to `node22-win-x64` (zdefiniowany w `package.json` → `pkg.targets`). Wersja wbudowanego Node jest niezależna od Node zainstalowanego na maszynie budującej.
- Zasoby (`public/**/*` oraz `node_modules/socket.io/client-dist/**/*`) są **wbudowane** w `.exe` — nie trzeba ich kopiować osobno.

## 3. Wdrożenie na stacji-serwerze

1. Utwórz **zapisywalny** katalog, np. `C:\Andon\` (NIE `C:\Program Files\` — tam brak praw zapisu).
2. Skopiuj tam `andon.exe`.
3. Uruchom (dwuklik lub z konsoli). W konsoli zobaczysz: `Serwer Andon działa na porcie 80`.
4. Sprawdź lokalnie: otwórz `http://localhost/`.

Obok `.exe` powstanie plik **`andon_state.json`** — trwały stan aplikacji (cele, planner, bieżąca zmiana, liczniki). Musi to być katalog z prawem zapisu.

Zmiana portu (gdyby 80 był zajęty):
```powershell
# PowerShell
$env:PORT=8080; .\andon.exe
```
```cmd
:: cmd
set PORT=8080 && andon.exe
```
> Uwaga: port inny niż 80 może z powrotem wywołać blokadę portową zapory oraz wymóg `:port` w adresie u klientów.

## 4. Autostart bez uprawnień administratora

**Opcja A — Harmonogram zadań (zalecane):**
Task Scheduler → *Utwórz zadanie* → wyzwalacz **„Przy logowaniu"** (bieżący użytkownik) → akcja: uruchom `C:\Andon\andon.exe`. Zadania na poziomie użytkownika nie wymagają administratora.

**Opcja B — folder Autostart:**
`Win + R` → `shell:startup` → wrzuć skrót do `andon.exe`.

## 5. Dostęp klientów (zero-config)

- Operatorzy / TV / brygadzista: przeglądarka → `http://<IP-serwera>/` (np. `http://192.168.10.20/`).
- Zalecane: **stały IP** stacji-serwera + wpis w wewnętrznym DNS, aby adres brzmiał `http://andon/` (do ustalenia z IT). Wtedy adres jest łatwy do zapamiętania i „zero-config" po stronie klienta.
- Klienci **niczego nie instalują** — wystarczy przeglądarka.
- Logowanie: operator — hasło `123456`; Brygadzista / Dashboard TV — hasło `admin`.

## 6. Zapora sieciowa / ESET

- Port 80 usuwa problem blokad **portowych**.
- **ESET / firewall aplikacyjny** może jednak przy pierwszym nasłuchu zapytać lub zablokować nieznany `.exe`. Rozwiązania:
  - jednorazowo zezwól aplikacji na połączenia przychodzące w sieci lokalnej, lub
  - poproś IT o regułę zezwalającą dla tego pliku.
- **Docelowo zalecany podpis kodu (code signing)** certyfikatem organizacji — podpisane pliki nie są kwarantannowane przez AV. Bez podpisu możliwa kwarantanna — wtedy dodaj wyjątek u IT.
- Zapora Windows (jeśli aktywna): przy pierwszym uruchomieniu pojawi się monit „Zezwól na dostęp" — wybierz sieć **prywatną/domenową**.

## 7. Persystencja, aktualizacje, backup

- Cały stan trzymany jest w `andon_state.json` obok `.exe` — przetrwa restart serwera.
- **Aktualizacja aplikacji:** zatrzymaj `.exe`, podmień plik na nową wersję, uruchom ponownie. `andon_state.json` pozostaje (stan zachowany).
- **Wyzerowanie stanu:** przy zatrzymanym serwerze usuń `andon_state.json`.
- **Kopia zapasowa:** skopiuj `andon_state.json`.

## 8. Rozwiązywanie problemów

| Objaw | Przyczyna / rozwiązanie |
|---|---|
| `EADDRINUSE` / `EACCES` na porcie 80 | Port zajęty (IIS / HTTP.sys / „World Wide Web Publishing Service"). Sprawdź `netstat -ano \| findstr :80` i `netsh http show urlacl`. Zwolnij port albo uruchom z `PORT=8080`. |
| `.exe` znika po pobraniu/uruchomieniu | Kwarantanna antywirusa. Przywróć plik i dodaj wyjątek (patrz pkt 6). Docelowo: podpis kodu. |
| Stan się nie zapisuje | `.exe` uruchomiony z katalogu tylko-do-odczytu (np. `Program Files`). Przenieś do `C:\Andon\`. |
| Strona ładuje się, ale „Brak połączenia z serwerem" | Wchodzisz nie przez adres serwera. Użyj `http://<IP-serwera>/`, a nie pliku `file://`. |

## 9. Skrót — budowanie

```powershell
npm install
npm i -D @yao-pkg/pkg
npm run build
# wynik: dist\andon.exe
```
