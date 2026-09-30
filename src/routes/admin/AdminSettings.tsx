import {useEffect, useRef, useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {VStack, HStack} from '@astryxdesign/core/Layout';
import {Card} from '@astryxdesign/core/Card';
import {Grid} from '@astryxdesign/core/Grid';
import {Heading} from '@astryxdesign/core/Heading';
import {Text} from '@astryxdesign/core/Text';
import {Button} from '@astryxdesign/core/Button';
import {TextInput} from '@astryxdesign/core/TextInput';
import {TextArea} from '@astryxdesign/core/TextArea';
import {NumberInput} from '@astryxdesign/core/NumberInput';
import {Switch} from '@astryxdesign/core/Switch';
import {Selector} from '@astryxdesign/core/Selector';
import {Banner} from '@astryxdesign/core/Banner';
import {Token} from '@astryxdesign/core/Token';
import {Divider} from '@astryxdesign/core/Divider';
import {TabList, Tab} from '@astryxdesign/core/TabList';
import {useToast} from '@astryxdesign/core/Toast';
import {useTenant} from '../../tenants/TenantContext.tsx';
import {
  photoUrl,
  studioSettingsSchema,
  type GalleryItem,
  type OwnerEditableKey,
  type StudioSettings,
} from '../../tenants/schema.ts';
import {ICON_NAMES, IconByName} from '../../components/icons.tsx';
import {uploadStudioPhoto, useSaveSettings} from '../../lib/owner.ts';
import {timeFromMinutes} from '../../lib/schedule.ts';
import {DateField} from './AdminBookings.tsx';

type Patch = Partial<Pick<StudioSettings, OwnerEditableKey>>;

const TABS = [
  {value: 'main', label: 'Основное'},
  {value: 'services', label: 'Услуги'},
  {value: 'schedule', label: 'График'},
  {value: 'cards', label: 'Карточки'},
  {value: 'photos', label: 'Фото'},
];

/**
 * Настройки студии. Каждая вкладка сохраняет только свои поля — правки
 * соседних вкладок не затираются. Проверка — дважды: zod-схемой здесь
 * (понятная ошибка сразу) и owner_save_settings на сервере (защита).
 */
export function AdminSettings() {
  const {settings} = useTenant();
  const [tab, setTab] = useState('main');
  if (!settings) return null;
  return (
    <VStack gap={4}>
      <TabList aria-label="Разделы настроек" value={tab} onChange={setTab} size="sm">
        {TABS.map((t) => (
          <Tab key={t.value} value={t.value} label={t.label} />
        ))}
      </TabList>
      {/* key: после сохранения форма берёт свежие данные с сервера. */}
      {tab === 'main' ? <MainTab key={stamp(settings, ['name', 'phone', 'address', 'heroPhoto', 'logo'])} settings={settings} /> : null}
      {tab === 'services' ? <ServicesTab key={stamp(settings, ['services'])} settings={settings} /> : null}
      {tab === 'schedule' ? <ScheduleTab key={stamp(settings, ['hours', 'boxes', 'closedDates'])} settings={settings} /> : null}
      {tab === 'cards' ? <CardsTab key={stamp(settings, ['infoCards'])} settings={settings} /> : null}
      {tab === 'photos' ? <PhotosTab settings={settings} /> : null}
    </VStack>
  );
}

function stamp(s: StudioSettings, keys: (keyof StudioSettings)[]): string {
  return JSON.stringify(keys.map((k) => s[k]));
}

/** Сохранение с проверкой схемой: ошибка показывается по-русски, до сервера. */
function useSave() {
  const {slug, settings} = useTenant();
  const save = useSaveSettings(slug);
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const run = async (patch: Patch, okText = 'Сохранено') => {
    setError(null);
    const parsed = studioSettingsSchema.safeParse({...settings, ...patch});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(`${issue.path.join(' → ')}: ${issue.message}`);
      return false;
    }
    try {
      const clean: Record<string, unknown> = {};
      for (const k of Object.keys(patch)) clean[k] = parsed.data[k as keyof StudioSettings];
      await save.mutateAsync(clean as Patch);
      toast({type: 'info', body: okText});
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  return {run, error, isSaving: save.isPending};
}

function SaveBar({onSave, isSaving, error}: {onSave: () => void; isSaving: boolean; error: string | null}) {
  return (
    <VStack gap={2}>
      {error ? <Banner status="error" title="Не сохранено" description={error} /> : null}
      <HStack gap={2}>
        <Button label="Сохранить" variant="primary" size="lg" isLoading={isSaving} clickAction={onSave} />
      </HStack>
    </VStack>
  );
}

// ---------------------------------------------------------------------------
// Основное
// ---------------------------------------------------------------------------

function MainTab({settings}: {settings: StudioSettings}) {
  const {slug} = useTenant();
  const {run, error, isSaving} = useSave();
  const [name, setName] = useState(settings.name);
  const [tagline, setTagline] = useState(settings.tagline);
  const [description, setDescription] = useState(settings.description);
  const [phone, setPhone] = useState(settings.phone);
  const [address, setAddress] = useState(settings.address);
  const [suggestions, setSuggestions] = useState(settings.assistantSuggestions);

  return (
    <VStack gap={4}>
      <Grid columns={{minWidth: 280}} gap={4}>
        <PhotoCard
          title="Главное фото"
          hint="Большое фото машины на первом экране. Лучше горизонтальное, от 1600 px."
          url={photoUrl(slug, settings.heroPhoto)}
          onUploaded={(url) => run({heroPhoto: url}, 'Главное фото заменено')}
        />
        <PhotoCard
          title="Логотип"
          hint="Квадратный, на прозрачном или тёмном фоне."
          url={settings.logo ? photoUrl(slug, settings.logo) : ''}
          onUploaded={(url) => run({logo: url}, 'Логотип обновлён')}
          onRemove={settings.logo ? () => run({logo: null}, 'Логотип убран') : undefined}
        />
      </Grid>

      <Card padding={4}>
        <VStack gap={3}>
          <Heading level={3}>Студия</Heading>
          <TextInput label="Название" value={name} onChange={setName} />
          <TextInput label="Подзаголовок" value={tagline} onChange={setTagline} />
          <TextArea label="Описание" value={description} onChange={setDescription} />
          <TextInput label="Телефон" value={phone} onChange={setPhone} />
        </VStack>
      </Card>

      <Card padding={4}>
        <VStack gap={3}>
          <Heading level={3}>Адрес</Heading>
          <TextInput label="Адрес одной строкой" value={address.full} onChange={(v) => setAddress({...address, full: v})} description="Используется для карты и в напоминаниях" />
          <Grid columns={{minWidth: 200}} gap={3}>
            <TextInput label="Город" value={address.city} onChange={(v) => setAddress({...address, city: v})} />
            <TextInput label="Улица, дом" value={address.street} onChange={(v) => setAddress({...address, street: v})} />
            <NumberInput label="Широта" value={address.latitude} onChange={(v) => setAddress({...address, latitude: v})} step={0.000001} hasClear />
            <NumberInput label="Долгота" value={address.longitude} onChange={(v) => setAddress({...address, longitude: v})} step={0.000001} hasClear />
          </Grid>
          <TextArea label="Как добраться" value={address.directionsNote} onChange={(v) => setAddress({...address, directionsNote: v})} size="sm" />
        </VStack>
      </Card>

      {settings.assistantEnabled ? (
      <Card padding={4}>
        <VStack gap={3}>
          <Heading level={3}>Подсказки помощника</Heading>
          <Text type="supporting" color="secondary">
            Кнопки-примеры на главной и в чате, от 1 до 4.
          </Text>
          {suggestions.map((q, i) => (
            <HStack key={i} gap={2} vAlign="end">
              <TextInput label={`Подсказка ${i + 1}`} value={q} onChange={(v) => setSuggestions(suggestions.map((x, j) => (j === i ? v : x)))} width="100%" />
              {suggestions.length > 1 ? (
                <Button label="Убрать" variant="ghost" size="md" clickAction={() => setSuggestions(suggestions.filter((_, j) => j !== i))} />
              ) : null}
            </HStack>
          ))}
          {suggestions.length < 4 ? (
            <Button label="Добавить подсказку" variant="secondary" size="sm" clickAction={() => setSuggestions([...suggestions, ''])} />
          ) : null}
        </VStack>
      </Card>
      ) : null}

      <SaveBar
        isSaving={isSaving}
        error={error}
        onSave={() =>
          run({
            name: name.trim(),
            tagline,
            description,
            phone: phone.trim(),
            address,
            // Подсказки сохраняем, только когда их видно (помощник включён).
            ...(settings.assistantEnabled ? {assistantSuggestions: suggestions.map((s) => s.trim()).filter(Boolean)} : {}),
          })
        }
      />
    </VStack>
  );
}

// ---------------------------------------------------------------------------
// Услуги
// ---------------------------------------------------------------------------

function ServicesTab({settings}: {settings: StudioSettings}) {
  const {run, error, isSaving} = useSave();
  const [items, setItems] = useState(settings.services);
  const update = (i: number, patch: Partial<StudioSettings['services'][number]>) =>
    setItems(items.map((s, j) => (j === i ? {...s, ...patch} : s)));

  return (
    <VStack gap={4}>
      <Text type="body" color="secondary">
        Цена — в рублях. Длительность — рабочее время за день; для работ на несколько дней бокс занят до закрытия последнего дня.
      </Text>
      {items.map((s, i) => (
        <Card key={s.id} padding={4}>
          <VStack gap={3}>
            <HStack gap={3} vAlign="center" justify="between">
              <HStack gap={2} vAlign="center">
                <IconByName name={s.icon} size={22} />
                <Heading level={3}>{s.name || 'Новая услуга'}</Heading>
              </HStack>
              <Button
                label="Удалить"
                variant="ghost"
                size="sm"
                isDisabled={items.length <= 1}
                clickAction={() => setItems(items.filter((_, j) => j !== i))}
              />
            </HStack>
            <TextInput label="Название" value={s.name} onChange={(v) => update(i, {name: v})} />
            <TextArea label="Описание" value={s.description} onChange={(v) => update(i, {description: v})} size="sm" />
            <Grid columns={{minWidth: 150}} gap={3}>
              <NumberInput label="Цена" value={Math.round(s.price / 100)} onChange={(v) => update(i, {price: Math.round((v ?? 0) * 100)})} min={0} units="₽" isIntegerOnly />
              <NumberInput label="Длительность" value={s.durationMin} onChange={(v) => update(i, {durationMin: v ?? 60})} min={15} max={1440} step={15} units="мин" isIntegerOnly />
              <NumberInput label="Дней" value={s.days} onChange={(v) => update(i, {days: v ?? 1})} min={1} max={14} isIntegerOnly hasNumberSteppers />
              <Selector
                label="Иконка"
                value={s.icon}
                onChange={(v) => update(i, {icon: v})}
                options={ICON_NAMES.map((n) => ({value: n, label: n}))}
                hasSearch
              />
            </Grid>
            <HStack gap={4} wrap="wrap">
              <Switch label="Показывать клиентам" value={s.isActive} onChange={(v) => update(i, {isActive: v})} />
              <Switch label="Популярная" value={s.isPopular} onChange={(v) => update(i, {isPopular: v})} />
            </HStack>
          </VStack>
        </Card>
      ))}
      <Button
        label="Добавить услугу"
        variant="secondary"
        clickAction={() =>
          setItems([
            ...items,
            {id: `svc-${Date.now().toString(36)}`, name: '', description: '', price: 0, durationMin: 60, days: 1, icon: 'sparkle', isPopular: false, isActive: true},
          ])
        }
      />
      <SaveBar isSaving={isSaving} error={error} onSave={() => run({services: items}, 'Услуги сохранены')} />
    </VStack>
  );
}

// ---------------------------------------------------------------------------
// График: часы, нерабочие даты, боксы, правила
// ---------------------------------------------------------------------------

const DAYS = [
  {day: 1, label: 'Понедельник'},
  {day: 2, label: 'Вторник'},
  {day: 3, label: 'Среда'},
  {day: 4, label: 'Четверг'},
  {day: 5, label: 'Пятница'},
  {day: 6, label: 'Суббота'},
  {day: 0, label: 'Воскресенье'},
];
const TIMES = Array.from({length: 48}, (_, i) => timeFromMinutes(i * 30));

function ScheduleTab({settings}: {settings: StudioSettings}) {
  const {run, error, isSaving} = useSave();
  const [hours, setHours] = useState(settings.hours);
  const [closed, setClosed] = useState(settings.closedDates);
  const [newDate, setNewDate] = useState('');
  const [boxes, setBoxes] = useState(settings.boxes);
  const [bufferMin, setBuffer] = useState(settings.bufferMin);
  const [minNoticeHours, setNotice] = useState(settings.minNoticeHours);
  const [bookingHorizonDays, setHorizon] = useState(settings.bookingHorizonDays);
  const [cancellation, setCancellation] = useState(settings.cancellation);

  const setDay = (day: number, patch: Partial<StudioSettings['hours'][number]>) =>
    setHours(hours.map((h) => (h.day === day ? {...h, ...patch} : h)));

  return (
    <VStack gap={4}>
      <Card padding={4}>
        <VStack gap={3}>
          <Heading level={3}>Часы работы</Heading>
          {DAYS.map(({day, label}) => {
            const h = hours.find((x) => x.day === day)!;
            const open = h.open !== null;
            return (
              <HStack key={day} gap={3} vAlign="end" wrap="wrap">
                <Switch label={label} value={open} onChange={(v) => setDay(day, v ? {open: '10:00', close: '18:00'} : {open: null, close: null})} width={190} />
                {open ? (
                  <>
                    <Selector label="С" value={h.open!} onChange={(v) => setDay(day, {open: v})} options={TIMES} size="sm" />
                    <Selector label="До" value={h.close!} onChange={(v) => setDay(day, {close: v})} options={TIMES} size="sm" />
                  </>
                ) : (
                  <Text type="supporting" color="secondary">выходной</Text>
                )}
              </HStack>
            );
          })}
        </VStack>
      </Card>

      <Card padding={4}>
        <VStack gap={3}>
          <Heading level={3}>Нерабочие даты</Heading>
          <Text type="supporting" color="secondary">Праздники, отпуск, ремонт — в эти дни запись закрыта.</Text>
          <HStack gap={2} wrap="wrap">
            {closed.length === 0 ? <Text type="supporting" color="secondary">Нет</Text> : null}
            {[...closed].sort().map((d) => (
              <Token key={d} label={d.split('-').reverse().join('.')} onRemove={() => setClosed(closed.filter((x) => x !== d))} />
            ))}
          </HStack>
          <HStack gap={2} vAlign="end" wrap="wrap">
            <DateField label="Добавить дату" value={newDate} onChange={setNewDate} />
            <Button
              label="Добавить"
              variant="secondary"
              isDisabled={!newDate || closed.includes(newDate)}
              clickAction={() => {
                setClosed([...closed, newDate]);
                setNewDate('');
              }}
            />
          </HStack>
        </VStack>
      </Card>

      <Card padding={4}>
        <VStack gap={3}>
          <Heading level={3}>Боксы</Heading>
          {boxes.map((b, i) => (
            <HStack key={b.id} gap={3} vAlign="end" wrap="wrap">
              <TextInput label="Название" value={b.name} onChange={(v) => setBoxes(boxes.map((x, j) => (j === i ? {...x, name: v} : x)))} width={200} />
              <Switch label="Многодневные работы" value={b.acceptsLongStay} onChange={(v) => setBoxes(boxes.map((x, j) => (j === i ? {...x, acceptsLongStay: v} : x)))} />
              <Switch label="Работает" value={b.isActive} onChange={(v) => setBoxes(boxes.map((x, j) => (j === i ? {...x, isActive: v} : x)))} />
              <Button label="Удалить" variant="ghost" size="sm" isDisabled={boxes.length <= 1} clickAction={() => setBoxes(boxes.filter((_, j) => j !== i))} />
            </HStack>
          ))}
          <Button
            label="Добавить бокс"
            variant="secondary"
            size="sm"
            clickAction={() => setBoxes([...boxes, {id: `box-${Date.now().toString(36)}`, name: `Бокс ${boxes.length + 1}`, acceptsLongStay: true, isActive: true}])}
          />
          <Text type="supporting" color="secondary">
            Удалённый бокс не снимает уже сделанные в него записи — перенесите их в «Записях».
          </Text>
        </VStack>
      </Card>

      <Card padding={4}>
        <VStack gap={3}>
          <Heading level={3}>Правила записи</Heading>
          <Grid columns={{minWidth: 200}} gap={3}>
            <NumberInput label="Перерыв между машинами" value={bufferMin} onChange={(v) => setBuffer(v ?? 0)} min={0} max={240} step={5} units="мин" isIntegerOnly />
            <NumberInput label="Запись не позже чем за" value={minNoticeHours} onChange={(v) => setNotice(v ?? 0)} min={0} max={720} units="ч" isIntegerOnly />
            <NumberInput label="Запись открыта на" value={bookingHorizonDays} onChange={(v) => setHorizon(v ?? 30)} min={1} max={120} units="дней" isIntegerOnly />
            <NumberInput label="Бесплатная отмена за" value={cancellation.freeCancelHours} onChange={(v) => setCancellation({...cancellation, freeCancelHours: v ?? 0})} min={0} max={720} units="ч" isIntegerOnly />
          </Grid>
          <TextArea label="Правила отмены для клиента" value={cancellation.note} onChange={(v) => setCancellation({...cancellation, note: v})} size="sm" />
        </VStack>
      </Card>

      <SaveBar
        isSaving={isSaving}
        error={error}
        onSave={() => run({hours, closedDates: closed, boxes, bufferMin, minNoticeHours, bookingHorizonDays, cancellation}, 'График сохранён')}
      />
    </VStack>
  );
}

// ---------------------------------------------------------------------------
// Три информационные карточки
// ---------------------------------------------------------------------------

function CardsTab({settings}: {settings: StudioSettings}) {
  const {run, error, isSaving} = useSave();
  const [cards, setCards] = useState(settings.infoCards);
  return (
    <VStack gap={4}>
      <Text type="body" color="secondary">Три карточки «Почему к нам» на главной.</Text>
      <Grid columns={{minWidth: 260}} gap={3}>
        {cards.map((c, i) => (
          <Card key={c.id} padding={4}>
            <VStack gap={3}>
              <HStack gap={2} vAlign="center">
                <IconByName name={c.icon} size={22} />
                <Text type="label" weight="semibold">Карточка {i + 1}</Text>
              </HStack>
              <TextInput label="Заголовок" value={c.title} onChange={(v) => setCards(cards.map((x, j) => (j === i ? {...x, title: v} : x)))} />
              <TextArea label="Текст" value={c.text} onChange={(v) => setCards(cards.map((x, j) => (j === i ? {...x, text: v} : x)))} size="sm" />
              <Selector label="Иконка" value={c.icon} onChange={(v) => setCards(cards.map((x, j) => (j === i ? {...x, icon: v} : x)))} options={ICON_NAMES.map((n) => ({value: n, label: n}))} hasSearch />
            </VStack>
          </Card>
        ))}
      </Grid>
      <SaveBar isSaving={isSaving} error={error} onSave={() => run({infoCards: cards}, 'Карточки сохранены')} />
    </VStack>
  );
}

// ---------------------------------------------------------------------------
// Фото работ
// ---------------------------------------------------------------------------

/**
 * Галерея: добавить карточку, заменить фото конкретной карточки, изменить
 * подпись конкретной карточки. Каждое действие строит новый список от
 * СВЕЖИХ данных с сервера и меняет ровно один элемент — остальные фото и
 * подписи остаются как были.
 */
function PhotosTab({settings}: {settings: StudioSettings}) {
  const {slug} = useTenant();
  const qc = useQueryClient();
  const {run, error} = useSave();
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  const latest = (): GalleryItem[] => {
    const fresh = qc.getQueryData<StudioSettings>(['studio', slug]) ?? settings;
    return [...fresh.gallery].sort((a, b) => a.order - b.order);
  };
  const gallery = [...settings.gallery].sort((a, b) => a.order - b.order);

  const add = async (file: File) => {
    setBusyId('new');
    try {
      const url = await uploadStudioPhoto(slug, file);
      const list = latest();
      const order = list.reduce((m, g) => Math.max(m, g.order), 0) + 1;
      await run({gallery: [...list, {id: `g-${Date.now().toString(36)}`, photo: url, caption: '', order}]}, 'Карточка добавлена');
    } catch (e) {
      toast({type: 'error', body: (e as Error).message});
    } finally {
      setBusyId(null);
    }
  };

  const replace = async (id: string, file: File) => {
    setBusyId(id);
    try {
      const url = await uploadStudioPhoto(slug, file);
      await run({gallery: latest().map((g) => (g.id === id ? {...g, photo: url} : g))}, 'Фото заменено');
    } catch (e) {
      toast({type: 'error', body: (e as Error).message});
    } finally {
      setBusyId(null);
    }
  };

  const caption = (id: string, text: string) =>
    run({gallery: latest().map((g) => (g.id === id ? {...g, caption: text} : g))}, 'Подпись сохранена');

  const remove = (id: string) => run({gallery: latest().filter((g) => g.id !== id)}, 'Карточка удалена');

  const move = (id: string, dir: -1 | 1) => {
    const list = latest();
    const i = list.findIndex((g) => g.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const swapped = [...list];
    [swapped[i], swapped[j]] = [swapped[j], swapped[i]];
    return run({gallery: swapped.map((g, k) => ({...g, order: k + 1}))}, 'Порядок сохранён');
  };

  return (
    <VStack gap={4}>
      <HStack gap={3} vAlign="center" justify="between" wrap="wrap">
        <Text type="body" color="secondary">Фото «Наши работы» на главной. Загрузка одного фото не трогает остальные.</Text>
        <FileButton label="Добавить карточку" variant="primary" isLoading={busyId === 'new'} onFile={add} />
      </HStack>
      {error ? <Banner status="error" title="Не сохранено" description={error} /> : null}
      <Grid columns={{minWidth: 260}} gap={3}>
        {gallery.map((g, i) => (
          <GalleryCard
            key={g.id}
            item={g}
            url={photoUrl(slug, g.photo)}
            isBusy={busyId === g.id}
            isFirst={i === 0}
            isLast={i === gallery.length - 1}
            onReplace={(f) => replace(g.id, f)}
            onCaption={(t) => caption(g.id, t)}
            onRemove={() => remove(g.id)}
            onMove={(d) => move(g.id, d)}
          />
        ))}
      </Grid>
    </VStack>
  );
}

function GalleryCard({
  item,
  url,
  isBusy,
  isFirst,
  isLast,
  onReplace,
  onCaption,
  onRemove,
  onMove,
}: {
  item: GalleryItem;
  url: string;
  isBusy: boolean;
  isFirst: boolean;
  isLast: boolean;
  onReplace: (f: File) => void;
  onCaption: (t: string) => Promise<boolean>;
  onRemove: () => void;
  onMove: (d: -1 | 1) => void;
}) {
  const [text, setText] = useState(item.caption);
  useEffect(() => setText(item.caption), [item.caption]);
  const [confirm, setConfirm] = useState(false);
  return (
    <Card padding={3}>
      <VStack gap={3}>
        <img className="admin-photo" src={url} alt={item.caption || 'Фото работы'} loading="lazy" />
        <TextInput label="Подпись" value={text} onChange={setText} placeholder="Например: полировка BMW X5" />
        <HStack gap={2} wrap="wrap">
          <Button label="Сохранить подпись" variant="secondary" size="sm" isDisabled={text === item.caption} clickAction={() => void onCaption(text)} />
          <FileButton label="Заменить фото" variant="secondary" size="sm" isLoading={isBusy} onFile={onReplace} />
        </HStack>
        <Divider />
        <HStack gap={2} wrap="wrap">
          <Button label="←" variant="ghost" size="sm" isDisabled={isFirst} clickAction={() => onMove(-1)} />
          <Button label="→" variant="ghost" size="sm" isDisabled={isLast} clickAction={() => onMove(1)} />
          {confirm ? (
            <>
              <Button label="Да, удалить" variant="secondary" size="sm" clickAction={onRemove} />
              <Button label="Нет" variant="ghost" size="sm" clickAction={() => setConfirm(false)} />
            </>
          ) : (
            <Button label="Удалить" variant="ghost" size="sm" clickAction={() => setConfirm(true)} />
          )}
        </HStack>
      </VStack>
    </Card>
  );
}

function PhotoCard({title, hint, url, onUploaded, onRemove}: {title: string; hint: string; url: string; onUploaded: (url: string) => void; onRemove?: () => void}) {
  const {slug} = useTenant();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Card padding={4}>
      <VStack gap={3}>
        <Heading level={3}>{title}</Heading>
        {url ? <img className="admin-photo" src={url} alt={title} /> : <Text type="supporting" color="secondary">Не загружен</Text>}
        <Text type="supporting" color="secondary">{hint}</Text>
        <HStack gap={2}>
          <FileButton
            label={url ? 'Заменить' : 'Загрузить'}
            variant="secondary"
            isLoading={busy}
            onFile={async (f) => {
              setBusy(true);
              try {
                onUploaded(await uploadStudioPhoto(slug, f));
              } catch (e) {
                toast({type: 'error', body: (e as Error).message});
              } finally {
                setBusy(false);
              }
            }}
          />
          {onRemove ? <Button label="Убрать" variant="ghost" clickAction={onRemove} /> : null}
        </HStack>
      </VStack>
    </Card>
  );
}

/** Кнопка выбора файла: скрытый input + обычная кнопка Astryx. */
function FileButton({
  label,
  onFile,
  isLoading,
  variant = 'secondary',
  size = 'md',
}: {
  label: string;
  onFile: (f: File) => void;
  isLoading?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        aria-label={label}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
      <Button label={label} variant={variant} size={size} isLoading={isLoading} clickAction={() => ref.current?.click()} />
    </>
  );
}
