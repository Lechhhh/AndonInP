# Panel sterowania

Panel: `/panelsterowania`, konfigurowalny przez ANDON_PANEL_PATH. Link ze strony głównej ukrywa ANDON_SHOW_PANEL_LINK=false.

Logowanie pozostaje numerem pracownika. Właściciel zarządza osobami, ich rolami, aktywnością i dostępem do stanowisk Y0–Y4. Brygadzista zarządza linią, harmonogramem i eksportem. Pracownik ma dostęp do przypisanych stanowisk. Konta startowe są tworzone tylko przy braku bazy; aktualizacja zachowuje istniejące osoby.

Osoby można wyszukiwać; lista jest stronicowana. Usunięcie jest archiwizacją, pozostawia historię. Zablokowanie, zmiana lub usunięcie konta natychmiast odbiera jego aktywne sesje. Edycja własnego konta również wymaga ponownego logowania. Własnego konta Właściciela nie można usunąć, zablokować ani obniżyć jego roli.

Parametry celu i czasu zmieniaj po zatrzymaniu zmiany. Nowy start zeruje bieżące liczniki. Czas i przerwy oblicza serwer. Harmonogram nie resetuje aktywnej zmiany. Dane produkcji są zapisywane przed potwierdzeniem operacji.

Aktualne zasady sesji, szyfrowania, migracji, kopii, limitów i konfiguracji firmowej opisuje SECURITY.md. Stanowiska lokalnie: http://localhost:3000. Pełne zabezpieczenia transportu i ograniczenia sieciowe wymagają trybu production oraz konfiguracji IT.

## Historia i raporty

Nowa zakładka dla Właściciela i Brygadzisty zawiera trwały rejestr produkcji, pomiary, filtry dnia/tygodnia/miesiąca, stanowiska i rodzaju zdarzenia oraz wykresy. Wykresy i wskaźniki pokazują całą linię w wybranym okresie; filtry stanowiska i rodzaju zdarzenia dotyczą rejestru oraz Excela. Eksport XLSX przeniesiono do tej zakładki i obejmuje wszystkie rekordy zastosowanych filtrów, a nie tylko widoczną stronę. Godzinę harmonogramu wybiera się jawnie jako HH (00–23) i MM (00–59). Szczegóły opisuje HISTORIA_RAPORTY.md.

## Aktualizacja z poprawek kolegi

Stanowiska mają oznaczenia X0–X4. Panel Linia i takt pozwala Właścicielowi i Brygadziście włączać lub wyłączać nakładkę przerwy na TV bez zmiany naliczania przerw. Zmiana zatrzymuje się automatycznie po 24 godzinach, także po restarcie. Dashboard i panel mają lokalny test dźwięku i wyciszenie. Szczegóły: SCALENIE_KOLEGI.md.

Na dashboardzie zębatka Opcje otwiera wygląd, test dźwięku, wyciszenie i suwak głośności. Górny pasek ustawień został usunięty. Osobny podpisany link Panel sterowania prowadzi do zarządzania; podlega dotychczasowej konfiguracji widoczności linku.
