# Andon — klient desktop (Electron)

Natywny klient `.exe`, który łączy się z serwerem Andon w sieci lokalnej i wyświetla ten sam interfejs co przeglądarka. Powód istnienia: w środowiskach, gdzie ochrona web ESET filtruje ruch **przeglądarek**, aplikacja desktopowa (jak Discord/Slack) często nie jest filtrowana i łączy się bez problemu.

> Uwaga: to nie jest gwarancja. Jeśli polityka ESET jest ustawiona na filtrowanie **wszystkich** aplikacji, klient trafi na tę samą blokadę co przeglądarka — wtedy jedynym pewnym rozwiązaniem jest wyjątek w ESET wprowadzony przez IT (dla adresu serwera). Klient warto wdrażać równolegle z tym wyjątkiem, nie zamiast.

## Budowanie `.exe` (maszyna z Node + internetem)

```powershell
cd client
npm install                 # pobiera Electron (~kilkaset MB) + @electron/packager
npm run dist                # pakuje aplikację
```

Wynik: folder **`client\dist\AndonClient-win32-x64\`**, a w nim **`AndonClient.exe`**. Skopiuj cały ten folder na stację i uruchamiaj `AndonClient.exe` w środku — tak jak faktyczny Discord (który też jest folderem z plikiem `.exe`). Nie wymaga instalacji ani uprawnień administratora.

> Wcześniej używaliśmy `electron-builder` (jeden portable `.exe`), ale jego wersja 26.x wykłada się na kroku „node module collector". `@electron/packager` jest prostszy i omija ten problem. Jeśli koniecznie potrzebujesz pojedynczego `.exe`, wróć do `electron-builder` w wersji **24.13.3** (`npm i -D electron-builder@24.13.3`) i skryptu `electron-builder --win portable`.

Podgląd bez budowania (na maszynie deweloperskiej):
```powershell
npm start
```

## Użycie na stacji

1. Skopiuj folder `AndonClient-win32-x64` na stację (operatora / TV / brygadzisty) i uruchom `AndonClient.exe` w środku.
2. Przy pierwszym starcie pojawi się ekran **„Andon — połączenie"** — wpisz adres serwera:
   - samo IP, np. `192.168.10.20` (klient sam dopisze `http://`), albo
   - nazwę, np. `http://andon/` (jeśli macie wpis w DNS).
3. Adres zostaje zapamiętany — kolejne uruchomienia łączą się automatycznie.

Menu (skróty):
- **Ctrl+,** — zmień adres serwera
- **F5** — odśwież
- **F11** — pełny ekran (przydatne na stacji TV)

## Masowe wdrożenie (opcjonalnie)

Zamiast wpisywać adres ręcznie na każdej stacji, można ustawić zmienną środowiskową:
```
ANDON_SERVER=http://192.168.10.20/
```
(np. przez GPO albo w skrócie uruchamiającym). Klient użyje jej, jeśli nie ma zapisanej konfiguracji.

## Uwagi

- Klient nie zawiera logiki biznesowej — całość (stan, synchronizacja) jest po stronie serwera Andon. To tylko „okno" na serwer, więc wiele stacji z tym klientem jest w pełni zsynchronizowanych, tak samo jak przeglądarki.
- Rozmiar `.exe` to ~150–200 MB (wbudowany silnik Chromium) — to normalne dla aplikacji typu Electron.
- Jeśli ESET mimo wszystko zablokuje klienta, poproś IT o wyjątek dla `AndonClient.exe` oraz adresu serwera.
