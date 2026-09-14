# Połączenie poprawek kolegi — 13.09.2026

Źródło porównania: AndonInP-main (1).zip. Poprawki porównano z wcześniejszą kopią projektu, a następnie przeniesiono do aktualnego serwera z sesjami, rolami i historią SQLite.

## Przeniesione funkcje

- Mobilny dashboard: pionowy układ KPI i stanowisk, dopasowanie przycisków, marginesów i obszaru bezpiecznego ekranu. Poprawiono też ukrywanie nieaktywnego komunikatu na telefonie.
- Oznaczenia X0–X4 w ekranach, opcjach dostępu, raportach, Excelu i nowych powiadomieniach. Dawne identyfikatory y0–y4 pozostają kluczami technicznymi, aby zachować powiązania kont i historii. Odpowiednio Y0 odpowiada X0 itd. Historyczne opisy tekstowe pozostają niezmienione.
- Opcje wyglądu są dostępne bezpośrednio na dashboardzie pod zębatką Opcje, razem z ustawieniami dźwięku. Panel sterowania ma osobny podpisany link.
- W panelu Linia i takt dodano przełącznik nakładki przerwy. Dostęp wyłącznie z panelu dla Właściciela lub Brygadzisty, ścisła walidacja, limity operacji, odporność na powtórzenie żądania i zapis w szyfrowanej historii. Ustawienie przetrwa restart; nie wyłącza przerw ani blokady potwierdzania podczas przerwy.
- Zmiana jest automatycznie zatrzymywana po 24 godzinach od startu, zgodnie z decyzją właściciela. Kontrola działa w trakcie pracy, przed operacją oraz przy restarcie. Zachowuje start, licznik produkcji i historię, a zatrzymanie zapisuje dokładnie raz z czasem granicy 24 h. Zmiana nocna może przejść przez północ. Przy restarcie po dłuższej przerwie nie doliczamy kolejnych dni jako przestoju.
- Nowy MP3 kolegi: pełne dekodowanie bez błędów, wzmocnienie o 6 dB i ponowny zapis jako MP3 stereo 44,1 kHz / 192 kb/s. Zmierzony szczyt po konwersji: -3,5 dBFS, bez obcinania sygnału. Adres zasobu ma wersję, aby odświeżyć kopię w pamięci przeglądarki.

## Dźwięk

Na dashboardzie otwórz zębatkę **Opcje**, następnie kliknij **Włącz i sprawdź dźwięk**. Dostępna jest też regulacja głośności zapamiętywana na urządzeniu. W panelu przycisk testu pozostaje dostępny po zalogowaniu. Przycisk uruchamia rzeczywiste odtwarzanie bezpośrednio po kliknięciu. Kolejne wezwania uruchamiają sygnał; powtarzane synchronizacje i wezwania istniejące przed otwarciem widoku nie uruchamiają go ponownie. Przycisk Wycisz działa lokalnie. Wylogowanie i utrata sesji zatrzymują audio. Blokada odtwarzania oraz błąd pliku mają widoczny komunikat i możliwość ponowienia testu.

Dotychczasowa próba odblokowania audio następowała po asynchronicznym logowaniu i korzystała z wyciszonego odtwarzania; błędy były pomijane. Taka próba nie gwarantuje zgody na późniejsze słyszalne odtwarzanie. Zasady przeglądarek: [MDN — autoplay](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay). Sprawdź słyszalność na docelowych głośnikach; test przeglądarki nie weryfikuje fizycznego wyciszenia systemu ani głośników.

## Elementy już obecne w aktualnej wersji

Wylogowanie z unieważnieniem sesji, potwierdzenia zapisu/startu/stopu, serwerowe naliczanie czasu i reset przerw przy nowej zmianie są zachowane. Zegar dashboardu korzysta teraz również z czasu dostarczonego przez serwer. Pierwsze łączenie nie wyświetla fałszywego błędu, a rzeczywiste rozłączenie nadal jest sygnalizowane i zamyka sesję widoku. Potwierdzenie wezwania zachowuje uczciwy status kolejki; nie deklaruje dostarczenia do Discorda przed faktyczną wysyłką.

Pliki klienta Electron w ZIP są identyczne z wersją sprzed zabezpieczeń. Zachowano obecny klient i jego zabezpieczenia. Nie cofano logowania numerem, Argon2id, ról, szyfrowania, sesji, CSP, SQLite, wykresów ani eksportu; nie przenoszono starych zależności i instrukcji wdrażania z archiwum.

## Sprawdzenie i uruchomienie

- 47/47 testów automatycznych: istniejące zabezpieczenia i raporty, nocna zmiana, restart po 24 h, trwałość i błąd zapisu, autoryzacja nakładki, odtwarzanie i błędy audio.
- Edge w trybie bez okna, na izolowanej bazie: odtwarzanie po kliknięciu i nowym wezwaniu, rzeczywiste dekodowanie MP3 (3,7355 s), nakładka z dwóch oddzielnych sesji, zachowanie naliczania przerw, raporty, motywy, szerokości 320/375/430/500/768/1440 px. Brak błędów JavaScript w tych scenariuszach. Zrzuty oceniono wizualnie. Nie wykonywano testu na fizycznym iPhonie/Safari ani odsłuchu na głośnikach hali.
- security:check: publiczne pliki bez wykrytych wzorców sekretów i skryptów inline. Zależności bez zmian.

Aby uruchomić nowy kod, zatrzymaj poprzedni serwer Ctrl+C, wykonaj npm start i odśwież stronę Ctrl+F5. Następnie wykonaj test dźwięku na każdym urządzeniu, które ma sygnalizować wezwania.

## Druga paczka — 14.09.2026

Porównano `AndonInP-main (2).zip` z pierwszą paczką i bieżącą aplikacją. Dokumenty z archiwum potraktowano jako materiał porównawczy, a zakres zmian oparto na prośbach użytkownika.

- Przeniesiono i dopasowano układ dashboardu do ekranów Full HD i 4K, zachowując widok mobilny.
- Dodano obsługę wyboru stanowiska klawiaturą: strzałki, Home/End, Enter/Spacja i Escape. Poprawiono widoczność fokusu oraz poruszanie się między kontrolkami logowania.
- Dodano awaryjny sygnał trzech tonów przy niedostępności MP3. Działa po włączeniu dźwięku przez użytkownika, respektuje głośność i wyciszenie. Ręczny test ponawia próbę odtworzenia MP3. Plik audio nie zmienił się między paczkami; zachowano dotychczasową przygotowaną kopię.
- Zgodnie z decyzją użytkownika przesunięto odprawę drugiej zmiany na 14:00–14:05. Synchronizacja zegara i strefa czasowa były już obsługiwane przez aktualny serwer.

Zrealizowano też bieżące zgłoszenia: przycisk OK jest szary podczas zapisu, po potwierdzeniu stanowiska i przez 1,5 sekundy po zmianie cyklu. Bez licznika czasu. Osiągnięcie planu automatycznie kończy zmianę, a serwer blokuje dalsze potwierdzenia, aby zapobiec wynikom takim jak 9/8. Interfejs pokazuje „CEL OSIĄGNIĘTY”. Historyczne wyniki pozostają zachowane.

Aktualizacja wcześniejszego opisu połączenia: chwilowe rozłączenie nie zamyka sesji widoku; aplikacja ponawia połączenie i zachowuje formularze. Wygaśnięcie lub odwołanie sesji nadal wymaga logowania. Zachowano obecne zabezpieczenia, historię i klienta Electron.

Weryfikacja: 67/67 testów, kontrola publicznych plików i składni poprawne. Oceniono interfejs w przeglądarce przy szerokościach 375, 1920 i 3840 px oraz nawigację klawiaturą. Awaryjny dźwięk sprawdzono automatycznie, bez odsłuchu na docelowych głośnikach. Szczegóły w `TEST_REPORT.md`. Zmiany wymagają ponownego uruchomienia serwera i odświeżenia strony.
