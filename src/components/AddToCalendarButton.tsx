import {Button} from '@astryxdesign/core/Button';
import {HStack} from '@astryxdesign/core/Layout';
import {buildIcs, downloadIcs, googleCalendarUrl, type IcsInput} from '../lib/ics.ts';

/**
 * Кнопки «Добавить в календарь».
 *
 * Основной путь — файл .ics, он открывается в любом календаре.
 * Рядом ссылка на Google Calendar для тех, у кого его нет на телефоне.
 */
export function AddToCalendarButton({event, filename = 'zapis'}: {event: IcsInput; filename?: string}) {
  const ics = buildIcs(event);

  return (
    <HStack gap={3} style={{flexWrap: 'wrap', justifyContent: 'center'}}>
      <Button
        label="Добавить в календарь"
        variant="secondary"
        size="md"
        clickAction={() => downloadIcs(ics, `${filename}.ics`)}
      />
      <a href={googleCalendarUrl(event)} target="_blank" rel="noreferrer" style={{alignSelf: 'center'}}>
        <Button label="Google Calendar" variant="ghost" size="md" />
      </a>
    </HStack>
  );
}
