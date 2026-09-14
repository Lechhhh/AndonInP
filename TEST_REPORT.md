# Weryfikacja zmian bezpieczeństwa — 12.09.2026

- npm test: 25 testów, 25 poprawnych, bez pominięć. Testy używają osobnych katalogów i instancji serwera; nie zmieniają kont użytkownika.
- Zakres: szyfrowanie i integralność, migracja i Argon2id, CSRF/cookies, role i whitelisty, minimalizacja danych, blokowanie sesji, walidacja, ograniczenie rozmiaru, rate limiting, utrata zapisu, serwerowy czas, własność wezwania, blokady plików i konfiguracja HTTPS/proxy/sieci firmowych.
- Test przeglądarki: logowanie pracownika i widok Y0, logowanie Właściciela, lista osób/uprawnień. Bez błędów i ostrzeżeń konsoli w sprawdzonych widokach.
- npm audit po aktualizacji zależności: brak znanych podatności w serwerze i lockfile klienta.
- security:check: publiczne pliki bez wykrytych wzorców kluczy i skryptów inline. To skan wybranych wzorców, nie pełne DLP.
- Klient Electron: zmiany kodu i zależności; nie wykonano testu uruchomienia jego natywnego okna ani budowania EXE.
- Produkcyjnego certyfikatu, DNS, zapory, VPN/WAF i konfiguracji infrastruktury firmy nie wdrażano. Należą do etapu IT opisanego w SECURITY.md.

- Kopia offline: utworzenie, weryfikacja, odtworzenie do nowego katalogu i logowanie odtworzonym kontem przeszły poprawnie.
- Skrypt ACL klucza poprawnie odmówił zapisu klucza po odmowie Set-Acl w środowisku testowym. Ustawienie produkcyjnych ACL musi wykonać IT z odpowiednimi uprawnieniami.

## Historia i raporty — 13.09.2026

- 34/34 testy poprawne: serwer, szyfrowanie i SQL, transakcje, trwałość i filtry, role, DOM panelu i eksport XLSX.
- Test DOM sprawdził wybór godziny 23:05, dostęp Brygadzisty, tworzenie SVG, literalne wyświetlanie potencjalnego HTML, pełne 237 wierszy eksportu przy tabeli po 50 oraz anulowanie po wylogowaniu.
- Kopia bazy: zapis, dwukrotna weryfikacja, odtworzenie 1021 zdarzeń i stanu linii w nowym katalogu — poprawne.
- Audyt zależności serwera i klienta: 0 znanych podatności w chwili sprawdzania. Kontrola publicznych plików: 13 plików, brak wykrytych wzorców sekretów i skryptów inline.
- Narzędzie przeglądarki nie uruchamiało się z powodu błędu środowiska. Nowy widok sprawdzono w DOM, bez końcowej oceny wizualnej w natywnej przeglądarce.

## Dopracowanie wykresów — 13.09.2026

- 41/41 testów poprawnych; kontrola publicznych plików security:check zakończona poprawnie.
- Nowe testy: mediana/P90, indywidualny takt pomiaru, brakujące i błędne dane, brak podwójnego zliczania opóźnień, Pareto, stały zakres analizy przy filtrach rejestru, obsługa klawiatury i puste wykresy.
- Zweryfikowano wizualnie obrazy z rzeczywistych SVG interfejsu na danych testowych. Poprawiono przycinanie etykiet osi stanowisk. Narzędzie natywnej przeglądarki było niedostępne; nie sprawdzono pełnego układu strony w działającej przeglądarce.
- Zależności pozostają bez zmian; wcześniejszy wynik audytu zależności nie jest nowym audytem z tej aktualizacji.

## Połączenie zmian kolegi — 13.09.2026

- 47/47 testów poprawnych. Dodano przypadki granicy 24 h, zmiany nocnej, restartu, trwałości, awarii zapisu, ustawienia nakładki, uprawnień, oznaczeń X i obsługi audio.
- Izolowany Edge headless: rzeczywisty MP3 dekodowany i odtwarzany po kliknięciu oraz nowym wezwaniu, 6 szerokości od 320 do 1440 px, ciemny i jasny motyw, przełączanie nakładki między sesjami, zachowane przerwy i raporty; brak błędów JavaScript. Poprawiono ukrywanie komunikatu na telefonie.
- Pełne dekodowanie MP3 w FFmpeg; szczyt -3,5 dBFS po wzmocnieniu. Nie wykonano odsłuchu na fizycznych głośnikach ani testu Safari na urządzeniu.
- security:check: 15 plików publicznych, bez wykrytych wzorców sekretów i skryptów inline. Zależności bez zmian, bez nowego audytu zależności.
- Szczegółowe zestawienie: SCALENIE_KOLEGI.md.

## Poprawka Opcji dashboardu — 13.09.2026

- 47/47 testów i security:check poprawne.
- Edge headless na osobnej bazie: zębatka otwiera Opcje, test audio działa z okna ustawień, suwak 40% ustawia rzeczywistą głośność odtwarzacza 0,4; osobny link Panel sterowania, brak górnego paska, zmiana motywu.
- Wizualnie sprawdzono dashboard przy 320/375/430/500/768/1440 px oraz okno Opcji na komputerze i telefonie. Brak błędów JavaScript.

## Debugowanie aplikacji — 13.09.2026

- Punkt wyjścia: wszystkie istniejące 47 testów przechodziło. Sześć nowych testów odtworzyło cztery błędy przed zmianą kodu.
- Naprawiono pustą zakładkę „Czasy Wykonania” na TV: serwer przekazuje pomiary bez identyfikatorów pracowników. Widok operatora nadal nie otrzymuje pomiarów innych stanowisk.
- Naprawiono pozostawanie otwartych okien po rozłączeniu lub odwołaniu sesji. Interfejs zamyka okna, czyści komentarz wezwania i przywraca nieaktywność zamkniętego okna Opcji.
- Zablokowano równoległe próby logowania po wielokrotnym naciśnięciu Enter.
- Serwer ponownie sprawdza sesję po asynchronicznej weryfikacji kodu. Wylogowanie w trakcie weryfikacji skutkuje odrzuceniem logowania, bez utworzenia nowej sesji i cookie.
- Wynik końcowy: `npm test` — 53/53 testy poprawne; `npm run security:check` — 15 plików publicznych sprawdzonych; kontrola składni trzech zmienionych plików aplikacji — poprawna.
- Nowe scenariusze są w `test/debugging.test.js` i są uruchamiane przez `npm test`. Korzystają z JSDOM oraz izolowanego serwera HTTP i danych tymczasowych. Nie zmieniano bieżących danych produkcyjnych.
- W tej sesji nie wykonywano testu w natywnym oknie Electron ani oceny wizualnej w przeglądarce. Zależności nie były zmieniane ani ponownie audytowane.

## Powrót do karty i ponowne połączenie — 13.09.2026

- Przyczyna znaleziona w kodzie: dashboard i panel miały wyłączone ponowne łączenie, a każde zdarzenie `disconnect` usuwało tożsamość z interfejsu, również przy chwilowym błędzie transportu lub przekroczeniu czasu odpowiedzi.
- Włączono automatyczne ponawianie połączenia. Powrót do widocznej karty i odzyskanie sieci mogą przyspieszyć kolejną próbę. Krótka przerwa zachowuje widok, wpisany komentarz i formularze; komunikat o rozłączeniu znika po odebraniu aktualnego stanu.
- Operacje operatora są blokowane do czasu synchronizacji, a zgłaszanie i anulowanie wsparcia mają ograniczony czas oczekiwania na odpowiedź. Operacje panelu nie są wysyłane bez połączenia; zmiany linii dodatkowo wymagają aktualnego stanu.
- Zamknięcie okien i wyczyszczenie danych z poprzedniej poprawki dotyczy zakończenia lub odwołania sesji. Chwilowa utrata transportu nie kończy sesji. Faktyczne wygaśnięcie sesji lub odebranie dostępu nadal wymaga logowania.
- Dodano cztery scenariusze DOM oraz dwa testy łączące rzeczywiste skrypty interfejsu z izolowanym serwerem HTTP i Socket.IO. Sprawdzono zmianę widoczności karty, zerwanie transportu, odzyskanie danych bez kolejnego logowania, zachowanie formularza oraz odmowę ponownego połączenia po wygaśnięciu lub odwołaniu sesji.
- Wynik: `npm test` — 59/59; `security:check` i kontrola składni zmienionych skryptów — poprawne. Nie odtwarzano usypiania karty w konkretnej przeglądarce użytkownika; testy widoczności wykonano w JSDOM, a transportu na rzeczywistym połączeniu WebSocket.

## Potwierdzanie OK, limit planu i druga paczka kolegi — 14.09.2026

- `npm test`: 67/67 testów poprawnych. `npm run security:check`: 15 publicznych plików sprawdzonych, bez wykrytych wzorców sekretów i skryptów inline. Kontrola składni `lib/line.js`, `public/main.js`, `public/control-panel.js` i `public/support-sound.js` poprawna.
- OK pozostaje szare i nieaktywne podczas zapisu, po potwierdzeniu stanowiska oraz przez 1,5 sekundy po przejściu do kolejnego cyklu. Nie dodano licznika. Testy obejmują wielokrotne kliknięcie, synchronizację podczas zapisu, granicę czasu blokady i błąd odpowiedzi.
- Serwer kończy zmianę po osiągnięciu planu i odrzuca dalsze potwierdzenia. Sprawdzono 8/8, trwałość po restarcie, ponowienie żądania, nową zmianę, pojedynczy zapis zakończenia i brak podwójnego naliczania przestoju. Awaria zapisu ostatniego potwierdzenia nie pozostawia częściowej zmiany danych. Test rzeczywistego Socket.IO sprawdza równoległe potwierdzenia pięciu stanowisk i odrzucenie kolejnego kompletu.
- Sprawdzono granice odprawy drugiej zmiany: 14:00–14:05.
- Przeglądarka na izolowanych danych: wybór stanowiska klawiaturą, szary przycisk oczekiwania, dashboard przy 375×812, 1920×1080 i 3840×2160. Brak poziomego przepełnienia i błędów w sprawdzonej konsoli. Poprawiono opóźnienie widoczności listy, które uniemożliwiało natychmiastowe ustawienie fokusu klawiaturą.
- Awaryjny sygnał przy błędzie MP3 sprawdzono z atrapą AudioContext: tony, głośność, brak powtarzania po synchronizacji, wyciszenie i ponowna próba MP3. Nie wykonano odsłuchu na fizycznych głośnikach ani próby pilota na telewizorze.
- Nie zmieniano historycznych wyników przekraczających plan ani produkcyjnych danych. Nie restartowano produkcyjnego serwera. Zależności bez zmian i bez nowego audytu zależności. Szczegóły integracji w `SCALENIE_KOLEGI.md`.
