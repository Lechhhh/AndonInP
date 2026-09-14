# Historia i raporty — 13.09.2026

W panelu `/panelsterowania` dodano zakładkę **Historia i raporty**, dostępną dla Właściciela i Brygadzisty.

- Harmonogram używa dwóch pól wyboru: godzina **00–23** i minuta **00–59**. Format nie zależy od ustawień AM/PM przeglądarki.
- Historia pozostaje po rozpoczęciu nowej zmiany i restarcie. Rejestr obejmuje potwierdzenia stanowisk, zamknięcia cykli, start/stop zmian, parametry, harmonogram, wezwania i anulowanie wsparcia, wykryte przejścia przerw/przekroczeń taktu oraz wyniki powiadomień.
- Filtry: dzień, tydzień (poniedziałek–niedziela), miesiąc, stanowisko i kategoria. Strzałki przesuwają okres. Data jest dniem odniesienia dla wybranego tygodnia lub miesiąca. Można wybrać kolejność od najnowszych lub najstarszych zapisów.
- Widoczne są data i godzina w Polsce, typ zdarzenia, stanowisko, wykonawca, numer cyklu, czas netto, przypisany takt i szczegóły. Numer pracownika będący kodem dostępu nie jest ujawniany w raportach. Nazwisko jest zapisywane w momencie zdarzenia, więc późniejsza zmiana konta nie zmienia historii.
- Wykresy: cykle w takcie, po czasie i bez oceny w godzinach/dniach; udział spóźnionych pomiarów na stanowiskach; zarejestrowane przekroczenie taktu linii w czasie; przyczyny wezwań z udziałem procentowym i narastającym (Pareto). Wskaźniki: liczba pomiarów i cykli, zarejestrowany czas przekroczenia taktu linii, udział ocenionych pomiarów mieszczących się w takcie. Tabela stanowisk podaje liczebność próby, medianę, P90 czasu, P90 wykorzystania taktu oraz liczbę zapisów bez oceny. P90 to percentyl liczony metodą najbliższej rangi; mniej niż 10 poprawnych pomiarów oznaczono jako małą próbę. Każdy pomiar porównuje się z jego własnym zapisanym taktem, również gdy parametry zmieniały się w trakcie okresu. Brak czasu lub poprawnego taktu wyklucza pomiar z procentowej oceny terminowości. Czas pomiaru jest liczony od początku cyklu do potwierdzenia danego stanowiska, po odjęciu przerw; nie jest to sam czas ręcznej pracy operatora. Przekroczenia sumują zarejestrowane zamknięte cykle i zatrzymane zmiany; otwarty cykl zostanie doliczony po zamknięciu lub zatrzymaniu zmiany.
- Wykresy i wskaźniki obejmują całą linię w wybranym dniu, tygodniu lub miesiącu. Filtry stanowiska, kategorii i kolejności dotyczą tylko rejestru oraz Excela. Dzięki temu wybranie pomiarów jednego stanowiska nie usuwa cykli ani wezwań z wykresów. Brak danych nie jest przedstawiany jako rzeczywisty zerowy czas. Przekroczenie taktu jest przypisane do godziny/dnia zamknięcia cyklu albo zatrzymania zmiany, kiedy zostało zapisane; wykres nie odtwarza rzeczywistego rozkładu trwania opóźnienia między godzinami. Nie sumuje opóźnień poszczególnych stanowisk.
- Excel pobiera wszystkie wpisy z zastosowanych filtrów, niezależnie od strony tabeli. Eksport korzysta ze stałego zakresu zapisów widocznego przy wczytaniu raportu; nowe zdarzenia nie powodują duplikatów lub pominięć między stronami. Odśwież raport, aby objąć nowe dane. Wylogowanie lub zmiana filtrów przerywa trwające pobieranie. Tekst eksportowany jest jako tekst, nie formuły Excela.

## Baza, migracja i uruchomienie

Wymagany Node **24.14 lub nowszy**; sprawdzono na Node 24.17.0. SQLite korzysta z modułu Node, bez osobnego serwera bazy i bez dodatkowej usługi SQL.

```powershell
# W katalogu AndonInP, po zatrzymaniu poprzedniego serwera (Ctrl+C)
npm ci --ignore-scripts
npm start
```

Baza powstaje automatycznie w `ANDON_DATA_DIR/history.sqlite`, domyślnie `data/history.sqlite`. Pełny stan linii i zdarzenia są zatwierdzane w jednej transakcji. Szyfrowany `andon_state.json` staje się znacznikiem migracji. Do odczytu bazy potrzebny jest dotychczasowy klucz szyfrowania.

Nowy rejestr nie usuwa historii przy zerowaniu liczników zmiany i nie ma automatycznego obcinania do 200 pomiarów. Ograniczenie 200 dotyczy tylko podręcznego stanu bieżącej linii. Tabela pokazuje 50 wierszy na stronę, API najwyżej 200; podsumowanie i pojedynczy eksport obejmują maksymalnie 100 000 wpisów. Przy większym zakresie podsumowania wybierz krótszy okres; dla samego eksportu można dodatkowo zawęzić stanowisko lub kategorię. Dane nie są kasowane. Monitoruj miejsce na dysku i wykonuj kopie.

Pozostałe pomiary i logi ze starego formatu są importowane raz. Jeśli rekord nie ma pełnej daty, trafia do okresu **Import bez daty**, z zachowaną godziną, jeżeli jest dostępna. Nie zgadujemy daty ani osoby na podstawie numeru cyklu. Dane usunięte przez wcześniejsze resetowanie liczników lub dawny limit nie mogą zostać odzyskane przez tę migrację. Pełna historia zbiera się od uruchomienia nowej wersji.

## Ochrona i kopie

Treść zdarzeń, osoby, daty i stan linii są szyfrowane AES-256-GCM. Indeksy filtrów są HMAC; same pliki SQLite nadal ujawniają techniczną strukturę i liczbę zapisów. Zachowaj ochronę wolumenu i ACL opisaną w SECURITY.md. Zapytania SQL są parametryzowane, a raporty i eksport autoryzowane po stronie serwera. Pracownik nie ma dostępu do tych operacji.

Zaktualizowano `scripts/backup.js`. Po zatrzymaniu serwera kopia zawiera **dwa pliki**: np. `backup.enc` i `backup.enc.history.sqlite`. Przechowuj je razem, klucz osobno. Weryfikacja sprawdza integralność bazy i możliwość odszyfrowania zapisów. Odtworzenie wymaga nowego katalogu i zachowuje całą historię. Sam plik `andon_state.json` nie wystarczy już do kopii produkcji. Starsze kopie bez bazy nadal można odtworzyć; zaimportują zawarte w nich dostępne pomiary.

## Weryfikacja

Testy obejmują transakcje i rollback, trwałość, szyfrowanie, granice dnia/tygodnia/miesiąca, polską strefę czasu, stare wpisy bez daty, stronicowanie i stały zakres eksportu, blokowanie pracowników oraz dostęp Brygadzisty. Test DOM potwierdza wybór 23:05, działanie zakładki, filtrów, SVG, bezpieczne wyświetlanie tekstu, eksport pełnych 237 rekordów z tabeli stronicowanej i przerwanie eksportu po wylogowaniu. Dodatkowe testy sprawdzają obliczenia mediany i P90, zmienny takt, błędne/brakujące dane, zliczanie przekroczeń, Pareto, niezależność wykresów od filtrów rejestru i szczegóły dostępne klawiaturą. Oceniono wizualnie obrazy wygenerowane z rzeczywistych SVG interfejsu na danych testowych i poprawiono margines osi. Narzędzie przeglądarki było niedostępne; nie wykonano końcowej oceny całego układu w natywnej przeglądarce.

Bazę umieść na lokalnym dysku serwera. Nie używaj udziału SMB/NFS dla SQLite WAL. Wiele instancji aplikacji wymaga osobnego projektu wspólnej bazy i sesji.

