import {NavLink} from 'react-router-dom';
import {IconByName} from './icons.tsx';
import {useTenantSlug} from '../tenants/TenantContext.tsx';

const ITEMS = [
  {to: '', label: 'Главная', icon: 'home', end: true},
  {to: 'services', label: 'Услуги', icon: 'services', end: false},
  {to: 'my-booking', label: 'Моя запись', icon: 'clipboard', end: false},
] as const;

/**
 * Нижняя навигация: Главная, Услуги, Моя запись.
 */
export function BottomNav() {
  const slug = useTenantSlug();
  const base = `/s/${slug}`;

  return (
    <nav className="bottom-nav" aria-label="Основная навигация">
      <div className="bottom-nav__inner glass-surface">
        <ul className="bottom-nav__list" style={{listStyle: 'none', margin: 0, padding: 0}}>
          {ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={`${base}/${item.to}`}
                end={item.end}
                className="bottom-nav__link"
              >
                <IconByName name={item.icon} size={23} weight="fill" />
                <span>{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
