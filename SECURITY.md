# Bezpieczeństwo i uruchomienie firmowe

Stan zmian: 13.09.2026. Instrukcja dotyczy serwera Node i zabezpieczeń klienta Electron; nie zmienia instrukcji budowania EXE.

## Logowanie i poziomy dostępu

Zgodnie z decyzją Właściciela jedynym kodem logowania pozostaje ośmiocyfrowy numer pracownika. Konta startowe: Wiktor Filipowski — Właściciel; Zwykły pracownik — Pracownik. Istniejące konta są migrowane z zachowaniem identyfikatorów, nazw i ról. Nie są nadpisywane kontami startowymi.

Numer jest sprawdzany przez Argon2id: 64 MiB pamięci, 3 przebiegi, równoległość 1, losowa sól i tajny pepper wyprowadzany z klucza serwera. Wyszukiwanie konta używa HMAC. Samo haszowanie nie powstrzyma osoby znającej numer pracownika: ten model logowania nie zapewnia najwyższego poziomu uwierzytelniania. Dla kont uprzywilejowanych docelowym wzmocnieniem pozostaje firmowe SSO z MFA. Nie dodano osobnego hasła ani CAPTCHA od zewnętrznego dostawcy.

| Rola | Dostęp |
| --- | --- |
| Pracownik | Przypisane stanowiska; własne wezwania wsparcia |
| Brygadzista | Stanowiska, dashboard TV, parametry linii, zmiana, harmonogram, eksport |
| Właściciel | Wszystko powyżej oraz osoby, role, blokowanie, usuwanie i historia zmian |

Panel domyślnie działa pod `/panelsterowania`. `ANDON_PANEL_PATH` zmienia ścieżkę. `ANDON_SHOW_PANEL_LINK=false` ukrywa odnośnik na stronie głównej. Ukryta ścieżka nie zastępuje autoryzacji. To nie tworzy DNS ani certyfikatu domeny inpost.pl.

## Zaimplementowane mechanizmy

- Autoryzacja każdego zdarzenia Socket.IO na serwerze. Dane użytkownika i stanowisko pochodzą z sesji. Pracownik nie może zmieniać celu, ról, czasu, cudzych wezwań ani pobierać listy osób. Właściciel przypisuje dostęp do konkretnych stanowisk.
- Losowa sesja przechowywana na serwerze; w cookie tylko niejawny token. HttpOnly, SameSite=Strict, Path=/; w HTTPS Secure i prefiks `__Host-`. Rotacja po logowaniu, CSRF dla HTTP i handshake, kontrola Origin. Hashe i numery nie trafiają do danych sesji w przeglądarce. Numer widać Właścicielowi w zarządzaniu osobami, ponieważ służy do zarządzania kontem.
- Maksimum 8 godzin sesji; bezczynność 30 minut dla ról uprzywilejowanych i 60 minut dla pracownika. Automatyczne odświeżanie widoku nie przedłuża sesji. Zmiana konta, jego zablokowanie, usunięcie, wylogowanie i restart serwera unieważniają dostęp. Dashboard TV także podlega tym limitom.
- Limity: HTTP 600/min/IP, handshake 60/min/IP i 20 połączeń/IP; logowanie 15 prób/5 min/IP oraz 10 prób/5 min/numer; najwyżej 2 równoległe weryfikacje Argon2. Dodatkowe limity zdarzeń na IP, pracownika i operację. Odpowiedzi HTTP 429 zawierają Retry-After. Mapy i liczba sesji mają ograniczony rozmiar. Limity są pamięciowe i resetują się po restarcie. Jeden proces na zestaw plików danych; dla wielu instancji potrzebny wspólny magazyn sesji, limitów i danych.
- Schematy Zod z zamkniętą listą pól, typami i limitami; maksymalnie 16 KiB JSON/Socket.IO. Nieznane zdarzenia i dodatkowe pola są odrzucane. Wersjonowanie zmian osób chroni przed nadpisaniem równoległej edycji. Ochrona przed usunięciem własnego/ostatniego Właściciela.
- Szyfrowanie AES-256-GCM kont, całego stanu produkcji, kolejki powiadomień, kopii i prywatnych logów. Losowy IV, weryfikacja integralności i rozdzielenie zastosowań przez AAD. Zapis przez plik tymczasowy, fsync i rename; potwierdzenie operacji dopiero po zapisie. Kopia poprzedniego pliku również jest szyfrowana.
- Błędy wewnętrzne użytkownik dostaje jako ogólny komunikat z identyfikatorem zdarzenia. Szczegóły są w szyfrowanym logu serwera, z usuniętymi numerami i skonfigurowanymi sekretami. Logi: około 5 MiB na plik, 5 archiwów. Historia zmian kont: ostatnie 10000 wpisów, odpowiedź panelu: ostatnie 100. Monitoruj błędy zapisu logów na standardowym wyjściu błędów usługi.
- Odpowiedzi mają jawnie wybrane pola; strona osób zawiera do 100 rekordów (UI: 25). Pracownik otrzymuje tylko swoje stanowisko. Hashy, kluczy, danych kolejki i identyfikatorów autorów pomiarów nie ma w publicznym stanie.
- Treści użytkowników są wyświetlane jako tekst lub escapowane. Eksport XLSX zapisuje tekst jako inlineStr, bez formuł. CSP bez inline JavaScript i eval, blokada ramek, nosniff, polityka referrer i permissions, no-store, HSTS w trybie HTTPS. Font ikon pochodzi z serwera, bez Google Fonts.
- Baza zapisuje stan linii i zdarzenia w jednej transakcji SQLite (WAL, synchronous=FULL), przed potwierdzeniem operacji. Czas, takt, przestoje, przerwy i harmonogram oblicza serwer w strefie Europe/Warsaw. Powtórzenie tego samego requestId nie powiela operacji; stary cycleId jest odrzucany. Parametry można zmieniać po zatrzymaniu zmiany. Harmonogram nie zeruje już aktywnej zmiany.
- Zgłoszenie wsparcia jest najpierw zapisywane lokalnie. Wysyłka webhooka ma timeout, weryfikację celu HTTPS Discord, wyłączone przekierowania i ponowienia z wydłużanym odstępem. Kolejka ma limit 1000 wpisów. Brak webhooka pozostawia zgłoszenia w kolejce; powiadomienie w UI nie potwierdza dostarczenia. Komentarz trafia do Discorda, jeżeli IT skonfiguruje webhook — nie wpisuj w niego danych wrażliwych. Numer i nazwisko pracownika nie są dodawane do wiadomości zewnętrznej.
- Electron: sandbox, izolacja kontekstu, Node wyłączony w rendererze, kontrola nadawcy IPC, blokada obcych nawigacji, okien i uprawnień urządzeń. Serwer firmowy musi mieć HTTPS z prawidłowym certyfikatem; HTTP tylko na localhost. Wersje zależności klienta przypięte lockfile.
- `npm run security:audit` skanuje zależności serwera i klienta. `npm run security:check` wykrywa wybrane wzorce sekretów w publicznych plikach i skrypty inline. Dodano workflow testów/audytu i Dependabot (uruchomią się po umieszczeniu projektu w GitHub i włączeniu tych funkcji). Skan wzorców nie jest pełnym systemem DLP.

Historia produkcji i bieżący stan linii są teraz przechowywane w SQLite (data/history.sqlite). Zapytania używają parametrów; dynamiczne kolumny i kolejność pochodzą z zamkniętej listy. Treść rekordów i stan są szyfrowane AES-256-GCM, indeksy okresów, stanowisk i kategorii używają HMAC. Struktura tabel, numery sekwencji i rozmiary zapisów pozostają metadanymi SQLite — nie jest to SQLCipher ani szyfrowanie całego wolumenu. Konta nadal używają szyfrowanego pliku JSON. Dostęp do historii i eksportu jest sprawdzany po stronie serwera dla Właściciela i Brygadzisty w panelu.

## Start lokalny i pierwsza migracja

1. Zatrzymaj poprzedni serwer w jego terminalu (`Ctrl+C`). Nie uruchamiaj starej i nowej wersji jednocześnie.
2. W katalogu projektu uruchom `npm ci --ignore-scripts`, a potem `npm start`. Używaj Node 24 LTS z aktualnymi poprawkami (minimum: 24.14).
3. Otwórz `http://localhost:3000` oraz `http://localhost:3000/panelsterowania`. Istniejący `.env` może nadal ustawiać inny PORT; ustaw `PORT=3000` dla tego adresu.

Pierwszy start nowej wersji migruje pliki kont i stanu. Lokalnie generuje klucz `.andon-keys/master.key`. Zabezpiecz go i zachowaj oddzielną kopię. Nie kasuj go przy aktualizacji i nie twórz nowego dla istniejących danych. Serwer odmawia startu przy braku klucza do zaszyfrowanych plików. Nie edytuj zaszyfrowanych plików ręcznie.

Szyfrowanie nie usuwa historycznych jawnych kopii wykonanych poza aplikacją ani pozostałości na dysku. IT musi objąć stare kopie polityką retencji i zapewnić szyfrowanie wolumenu, np. BitLocker, oraz kopii systemowych. Dane w pamięci procesu i na ekranie uprawnionego użytkownika są jawne; nie jest to szyfrowanie end-to-end.

## Konfiguracja firmowa — do wykonania przez IT

Użyj `.env.example` jako wzoru. Produkcja odmawia startu bez originów HTTPS, listy dozwolonych adresów klientów, zewnętrznego klucza i TLS lub konkretnego zaufanego proxy. Wyjątek dla jawnie uruchamianych publicznych testów: `ANDON_PUBLIC_TEST_MODE=true` z pustym `ANDON_ALLOWED_CLIENTS` dopuszcza dowolne IP, zachowując pozostałe wymagania. Tryb domyślnie wyłączony; szczegóły i powrót do ograniczenia IP opisuje `RENDER.md`.

- Ustal domenę i certyfikat firmowy. Wariant preferowany: reverse proxy HTTPS na tym samym serwerze, Node na `127.0.0.1:3000`. Proxy musi obsługiwać WebSocket i nadpisywać nagłówki X-Forwarded-For/Proto. Do ANDON_TRUST_PROXY wpisz wyłącznie rzeczywiste adresy proxy; nie ufaj całej sieci użytkowników. Wariant alternatywny: certyfikat i klucz PEM w zmiennych ANDON_TLS_*; Node wymaga co najmniej TLS 1.2.
- Ustaw `NODE_ENV=production`, `ANDON_ALLOWED_ORIGINS` i `ANDON_ALLOWED_CLIENTS` na rzeczywiste podsieci firmowe/VPN. Przykładowa podsieć w pliku konfiguracyjnym nie jest rozpoznaną siecią InPost. Firewall ma ograniczyć dostęp do serwera i uniemożliwić ominięcie proxy.
- Uruchamiaj usługę na dedykowanym koncie bez administratora. Daj mu odczyt kodu/certyfikatu/klucza i zapis tylko danych/logów. ACL Windows nie wynikają z unixowego mode 0600 w Node; ustaw je jawnie. Zapewnij BitLocker, rotację logów/kopii, monitoring dostępności, aktualizacje Windows/Node i ochronę punktów końcowych.
- Utwórz zewnętrzny 32-bajtowy klucz base64. Pomocniczy skrypt: `powershell -File scripts/New-AndonKey.ps1 -KeyFile C:/ProgramData/AndonKeys/master.key -ServiceAccount "DOMENA\konto-uslugi"`. Wskaż nowy, pusty katalog wyłącznie na klucz. Skrypt ogranicza jego ACL do konta usługi i SYSTEM. Uruchom z odpowiednimi uprawnieniami; klucza nie drukuje.
- Ustaw ANDON_MASTER_KEY_FILE na ten plik. Alternatywą jest ANDON_MASTER_KEY przekazywany przez firmowy magazyn sekretów. Nigdy nie kopiuj klucza do public/, repo, obrazu klienta ani plików frontendowych. Klucz TLS i webhook również pozostają po stronie serwera.
- Jeśli dane wcześniej zaszyfrowano lokalnie, przenieś dotychczasowy klucz do chronionego miejsca. Nowy losowy klucz nie odszyfruje istniejącej bazy. Rotację klucza należy wykonać jako kontrolowaną migrację obejmującą ponowne szyfrowanie i przeliczenie hashy z pepperem; ta wersja nie ma automatycznej rotacji.
- Dodatkową ochronę przed ruchem rozproszonym zapewnia firmowy WAF/VPN. W aplikacji działa ochrona przed automatycznymi próbami, ale nie zastępuje ona ochrony DDoS na brzegu sieci. Przed wdrożeniem wymagany jest firmowy przegląd/pentest; testy repozytorium nie są certyfikacją bezpieczeństwa.

## Kopie, odtworzenie i logi

Kopie wykonuj po zatrzymaniu serwera. Polecenia dziedziczą te same zmienne środowiskowe i `.env` co aplikacja.

```powershell
node scripts/backup.js backup C:/AndonBackups/andon-2026-09-12.enc
node scripts/backup.js verify C:/AndonBackups/andon-2026-09-12.enc
$env:ANDON_BACKUP_FILE='C:/AndonBackups/andon-2026-09-12.enc'
node scripts/backup.js restore C:/AndonRestoreNowy
```

Restore wymaga nowego katalogu i nigdy nie nadpisuje czynnych danych. Ustaw później ANDON_DATA_DIR na odtworzony katalog, ANDON_STATE_FILE na jego andon_state.json i użyj tego samego klucza. Kopia obejmuje plik .enc oraz towarzyszący plik .enc.history.sqlite; zachowuj oba. Manifest .enc uwierzytelnia sumę kontrolną bazy. Kopia zawiera konta, aktualny stan z kolejką oraz pełną historię produkcji. Osobne pliki prywatnych logów trzeba archiwizować oddzielnie wraz z polityką retencji. Klucz przechowuj osobno od kopii i regularnie testuj odtworzenie. Poprzednia wersja aplikacji nie odczyta nowego formatu stanu. Plik andon_state.json po migracji jest tylko szyfrowanym znacznikiem; dane linii znajdują się w bazie historii. Nie usuwaj history.sqlite i nie kopiuj jej podczas działania serwera bez procedury backupu.

Prywatne logi są w ANDON_LOG_DIR, domyślnie data/logs, jako szyfrowane rekordy JSONL. Administrator może je odczytać offline poleceniem `node scripts/read-logs.js <plik-logu>`, używając tego samego klucza. Nie przekazuj odszyfrowanego wyjścia osobom bez uprawnień.
