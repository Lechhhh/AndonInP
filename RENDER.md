# Uruchomienie AndonInP na Render

Stan: 15.09.2026. Instrukcja dla bieżącej wersji projektu; konfiguracja konkretnej usługi wymaga jej domeny, wyboru ograniczenia IP lub publicznego testu i potwierdzonej konfiguracji proxy.

## Przyczyna błędu z logu

Build zakończył się poprawnie. Start zatrzymała kontrola w `lib/config.js`: tryb produkcyjny wymaga `ANDON_ALLOWED_CLIENTS`. Ostrzeżenie o dostępie do repozytorium nie zatrzymało tego wdrożenia — wskazany commit został pobrany. Log nie wskazuje błędu zależności ani Node.

Render domyślnie ustawia `NODE_ENV=production` podczas działania usługi. Lokalny plik `.env` jest wykluczony z repozytorium i nie jest automatycznie przenoszony na hosting. [Zmienne domyślne Render](https://render.com/docs/environment-variables).

## Ustawienia usługi

- Typ: Web Service, Node.js; katalog główny repozytorium.
- Build Command: `npm ci`.
- Start Command: `node server.js`.
- Jeden proces i jedna instancja dla tego zestawu danych.
- Host: `0.0.0.0`; port aplikacja odczytuje z `PORT` przekazanego przez Render. [Nasłuchiwanie usługi](https://render.com/docs/web-services).

W Render otwórz usługę → Environment → Add Environment Variable. Po uzupełnieniu wszystkich wartości wybierz Save and deploy. Same ustawienia środowiska nie wymagają zmiany kodu. [Instrukcja Render](https://render.com/docs/configure-environment-variables).

| Klucz | Wartość |
| --- | --- |
| `NODE_ENV` | `production` |
| `ANDON_HOST` | `0.0.0.0` |
| `ANDON_ALLOWED_ORIGINS` | `https://andoninpost.onrender.com` — bez końcowego `/` |
| `ANDON_ALLOWED_CLIENTS` | Publiczne IP dozwolonych sieci domowych, firmowych lub VPN. Dla pojedynczego IPv4: `ADRES_IP/32`; dla IPv6: `ADRES_IPV6/128`. Wiele wpisów oddziel przecinkami. |
| `ANDON_TRUST_PROXY` | `render` dla publicznego testu na Render z aktualnym kodem. Przy ograniczeniu IP: potwierdzone adresy lub zakresy proxy. Szczegóły poniżej. |
| `ANDON_MASTER_KEY` | Stały, tajny klucz: dokładnie 32 losowe bajty zakodowane jako base64. Dla przenoszonych danych użyj dotychczasowego klucza. |
| `ANDON_DATA_DIR` | `/var/data/andon/data` — przy dysku zamontowanym w `/var/data` |
| `ANDON_STATE_FILE` | `/var/data/andon/andon_state.json` |
| `ANDON_LOG_DIR` | `/var/data/andon/logs` |

`ANDON_ALLOWED_CLIENTS` oznacza adresy użytkowników widziane z internetu, a nie IP serwera Render, jego adresy wychodzące ani lokalne `192.168.x.x` komputera. Zmiana publicznego IP może wymagać aktualizacji listy. Nie ustawiaj `*`, `0.0.0.0/0` ani `::/0`; aplikacja odrzuca takie wartości. Tryb development również nie jest rozwiązaniem dla publicznej usługi.

## Publiczny dostęp na czas testów

Na prośbę użytkownika dodano opcjonalne `ANDON_PUBLIC_TEST_MODE=true`. Po wgraniu zmienionego kodu do repozytorium wdrażanego przez Render dodaj tę zmienną w Environment i usuń `ANDON_ALLOWED_CLIENTS` albo pozostaw jego wartość pustą. Nie wpisuj gwiazdki ani zakresów `/0`. Jednoczesna lista IP i włączony tryb testowy są odrzucane jako sprzeczna konfiguracja.

Tryb publicznego testu dopuszcza dowolne IP do ekranu logowania. Logowanie numerem pracownika, role, limity żądań, kontrola originu, HTTPS i klucz szyfrowania nadal obowiązują. Używaj danych testowych: osoba znająca kod pracownika nadal może się nim zalogować. Przy starcie serwer drukuje komunikat `PUBLICZNY TEST`.

Pozostaw `NODE_ENV=production`, `ANDON_HOST=0.0.0.0` i `ANDON_ALLOWED_ORIGINS=https://andoninpost.onrender.com`. Uzupełnij również proxy i klucz zgodnie z dalszą instrukcją. Sam przełącznik usuwa wyłącznie wymóg ograniczenia klientów do listy IP. Obsługa publicznego testu i profilu proxy wymaga aktualnego kodu; commit `fe4537fe` z logu nie zawiera jeszcze profilu proxy `render`.

Po testach ustaw `ANDON_PUBLIC_TEST_MODE=false`, uzupełnij `ANDON_ALLOWED_CLIENTS`, zastąp profil proxy `render` zweryfikowaną listą adresów proxy i ponownie wdróż usługę. Bez listy IP aplikacja znowu odmówi startu w produkcji.

### Komplet ustawień dla publicznego testu

Po wysłaniu nowego kodu na GitHub ustaw w Render → Environment:

```dotenv
NODE_ENV=production
ANDON_HOST=0.0.0.0
ANDON_ALLOWED_ORIGINS=https://andoninpost.onrender.com
ANDON_PUBLIC_TEST_MODE=true
ANDON_TRUST_PROXY=render
```

Usuń `ANDON_ALLOWED_CLIENTS` oraz `ANDON_TLS_CERT_FILE` i `ANDON_TLS_KEY_FILE`, jeśli były ustawione. HTTPS zapewnia Render. Nie ustawiaj ręcznie `RENDER` — platforma dostarcza tę zmienną. Istniejący webhook może pozostać.

Dodaj również `ANDON_MASTER_KEY`. Jeśli test zaczyna się na pustych danych, wygeneruj nowy klucz lokalnie w PowerShell; poniższe polecenie kopiuje go do schowka:

```powershell
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))" | Set-Clipboard
```

Wklej ze schowka do wartości `ANDON_MASTER_KEY` w Render. Nie wklejaj klucza do rozmowy ani repozytorium. Jeśli klucz jest już ustawiony lub przenosisz zaszyfrowane dane, zachowaj dotychczasowy klucz. Nie generuj go ponownie przy każdym wdrożeniu. Przy użyciu tej zmiennej usuń alternatywne `ANDON_MASTER_KEY_FILE`.

W Settings pozostaw Start Command `node server.js` oraz puste Health Check Path (kontrola TCP). Jeśli używasz trwałego dysku, ustaw również trzy ścieżki z tabeli powyżej. Dla krótkiego testu bez trwałego dysku można pozostawić domyślne ścieżki; dane zostaną utracone przy restarcie lub wdrożeniu.

Dopiero po uzupełnieniu wszystkich wartości wybierz Save, rebuild, and deploy (z nowym kodem). Docelowego wdrożenia nie wykonano w ramach lokalnych testów.

## Proxy i HTTPS

Render kończy TLS przed aplikacją i przekazuje do procesu HTTP. Aplikacja uznaje nagłówek `X-Forwarded-Proto: https` tylko od skonfigurowanego zaufanego proxy. [Opis architektury Render](https://render.com/tutorials/web-service-vs-static-site/web-services).

Dla publicznego testu profil `ANDON_TRUST_PROXY=render` ufa tylko bezpośredniemu pośrednikowi (jeden skok w Express). Wymaga `RENDER=true`, trybu production i jawnego publicznego testu. Zmienna `RENDER` jest wskaźnikiem środowiska, nie dowodem autentyczności żądania; profil zakłada ruch przez proxy platformy i zaufanie do pozostałych usług z dostępem do portu w jej sieci prywatnej. [Zmienne Render](https://render.com/docs/environment-variables), [sieć prywatna Render](https://render.com/docs/private-network).

Nie zakładamy, że prawy skrajny adres w `X-Forwarded-For` zawsze oznacza użytkownika: przy dodatkowych proxy limity i logi mogą grupować wielu użytkowników pod adresem pośrednika. Prefiks nagłówka podany przez klienta nie zmienia wybranego prawego adresu. Dlatego profil jest przeznaczony wyłącznie do publicznego testu i nie obsługuje autoryzacji na podstawie listy IP.

Dla wdrożenia z ograniczeniem IP potrzebne są potwierdzone adresy proxy. W sprawdzonej dokumentacji nie ustalono stałej listy dla tej konkretnej usługi; nie należy wpisywać adresów wychodzących z zakładki Connect ani zgadywać całych prywatnych podsieci. Aplikacja przyjmuje listę adresów/CIDR albo specjalny profil `render`, nie tekstową liczbę skoków `1`. Ustawienie `true` pozostaje zabronione.

Poprawne zaufanie do proxy jest konieczne zarówno dla HTTPS, jak i rozpoznania IP klienta. Nagłówki nie mogą pozwalać klientowi podszyć się pod dozwolony adres. [Express: konfiguracja proxy](https://expressjs.com/en/guide/behind-proxies/).

Pozostaw domyślną kontrolę TCP (puste Health Check Path). Obecny `/health` podlega ochronie IP i HTTPS, więc wewnętrzny test HTTP Render może otrzymać 403 lub 426. Kontrola TCP potwierdza jedynie, że proces przyjmuje połączenia; nie zastępuje testu logowania. [Health checks Render](https://render.com/docs/health-checks).

## Dane i klucz

Ta wersja używa lokalnej bazy SQLite oraz plików kont. Dla trwałych danych dołącz Persistent Disk z Mount Path `/var/data`; samo ustawienie zmiennych ścieżek nie tworzy trwałego dysku. Dyski są dostępne dla płatnych usług. Bez dysku zmiany plików przepadają przy restarcie lub kolejnym wdrożeniu, więc plan Free nadaje się tutaj wyłącznie do prób z danymi, które można utracić. [Trwałe dyski Render](https://render.com/docs/disks).

Alternatywnie do `ANDON_MASTER_KEY` można dodać Secret File `master.key` i ustawić `ANDON_MASTER_KEY_FILE=/etc/secrets/master.key`. Nie wpisuj jednocześnie obu wariantów. Nie dołączaj klucza ani produkcyjnych danych do repozytorium. Nowy klucz nie odszyfruje starej bazy; zachowaj osobną bezpieczną kopię właściwego klucza. Przenoszenie istniejących danych opisuje `SECURITY.md`.

## Kontrola po wdrożeniu

1. Z dozwolonej sieci otwórz adres HTTPS, zaloguj się i sprawdź synchronizację stanowisk.
2. Przy aktywnej liście IP sieć spoza listy powinna mieć odmowę dostępu. W publicznym trybie testowym różne sieci powinny widzieć logowanie, ale niezalogowana osoba nie może uzyskać danych produkcji ani sterować linią.
3. Sprawdź ponowne połączenie po zmianie karty.
4. Na danych testowych sprawdź zachowanie kont i historii po restarcie usługi.

Przygotowanie tej instrukcji nie zmienia ustawień w Render ani nie wdraża projektu. Publiczny test można skonfigurować powyższym kompletem zmiennych i właściwym kluczem. Wdrożenie z listą dozwolonych IP wymaga dodatkowo zweryfikowania adresów proxy.
