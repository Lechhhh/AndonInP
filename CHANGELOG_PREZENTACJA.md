# Changelog przed prezentacją

## Zmieniono
- Przeniesiono wysyłkę powiadomień Discord z przeglądarki do `server.js` i dodano konfigurację przez `DISCORD_WEBHOOK_URL`.
- Potwierdzenie zgłoszenia jest wyświetlane dopiero po poprawnej odpowiedzi webhooka. Błąd wysyłki daje czerwony komunikat z instrukcją działania zastępczego.
- Usunięto jawne hasła z kodu HTML. Logowanie i uprawnienia zdarzeń Socket.IO są weryfikowane na serwerze.
- Dodano serwerową walidację celu, czasu zmiany, plannera, stanowisk, znaczników czasu i tekstów zgłoszeń.
- Dodano `netShiftMins` do trwałego stanu. Panel brygadzisty odświeża cel i czas przy każdym otwarciu.
- Ujednolicono klucz motywu na `theme` i ustawianie motywu przed renderowaniem strony.
- Dodano banner utraty połączenia. Po zerwaniu sesji użytkownik wraca do logowania, aby po ponownym połączeniu odtworzyć uprawnienia serwerowe.
- Ikona pełnego ekranu reaguje także na wyjście klawiszem Esc.
- Dodano podstawową obsługę klawiatury i ARIA do wyboru stanowiska.
- Zapis stanu jest wykonywany przez plik tymczasowy i atomową podmianę, co ogranicza ryzyko uszkodzenia JSON.
- Usunięto artefakty `dist.7z` i `client/debug.log`; dodano reguły ignorowania.

## Świadomie pozostawiono bez zmian
- `public/workers.js` pozostaje dokładnie bez zmian i nadal nie jest wczytywany. Jest to nieaktywny pomysł, zgodnie z decyzją właściciela.
- Overlay przerwy pozostaje widoczny tylko na roli TV, natomiast dźwięk wsparcia działa dla TV i panelu brygadzisty. To rozdziela ekran informacyjny dla hali od panelu administracyjnego.
- Monolityczny `public/index.html` nie został rozbijany przed prezentacją, aby nie zwiększać ryzyka regresji przy wdrożeniu.
- Zachowano domyślne hasła jako awaryjne wartości zgodnościowe, ale nie są już obecne w kodzie klienta. Produkcyjnie należy ustawić własne zmienne środowiskowe.

## Wymagane przed spotkaniem
1. Unieważnić stary webhook Discord i wygenerować nowy.
2. Ustawić `DISCORD_WEBHOOK_URL`, `ANDON_ADMIN_PASSWORD` i `ANDON_OPERATOR_PASSWORD` na stacji-serwerze.
3. Przejść pełną checklistę z `prompt_naprawa_andon.md` na dwóch urządzeniach.
4. Sprawdzić webhook w docelowej sieci firmowej.
5. Otworzyć eksport `.xlsx` w rzeczywistym Microsoft Excel.
6. Przetestować restart gotowego `andon.exe` i odtworzenie `andon_state.json`.
