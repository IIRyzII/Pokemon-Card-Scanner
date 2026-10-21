import type { ReactNode } from 'react';
import { hasRole } from '../../shared/types.ts';
import { IconBrush, IconCards, IconPlus, IconSets, IconShield, IconUser } from './components/Icons.tsx';
import { CollectionProvider } from './lib/collection.tsx';
import { CurrencyProvider } from './lib/currency.tsx';
import { href, useRoute } from './lib/router.ts';
import { useSession } from './lib/session.tsx';
import { AccountPage } from './pages/AccountPage.tsx';
import { AddPage } from './pages/AddPage.tsx';
import { AdminPage } from './pages/AdminPage.tsx';
import { ArtistPage } from './pages/ArtistPage.tsx';
import { ArtistsPage } from './pages/ArtistsPage.tsx';
import { BinderEditPage } from './pages/BinderEditPage.tsx';
import { BinderPage } from './pages/BinderPage.tsx';
import { BindersPage } from './pages/BindersPage.tsx';
import { CardPage } from './pages/CardPage.tsx';
import { CollectionPage } from './pages/CollectionPage.tsx';
import { ItemPage } from './pages/ItemPage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { PendingPage } from './pages/PendingPage.tsx';
import { SetPage } from './pages/SetPage.tsx';
import { SetsPage } from './pages/SetsPage.tsx';
import { TrashPage } from './pages/TrashPage.tsx';

export function App() {
  const { status, user } = useSession();
  if (status === 'loading') return <div className="splash"><div className="spinner" /></div>;
  if (status === 'signedOut' || !user) return <LoginPage />;
  if (user.role === 'pending') return <PendingPage />;
  return (
    <CurrencyProvider>
      <CollectionProvider>
        <Shell />
      </CollectionProvider>
    </CurrencyProvider>
  );
}

function Shell() {
  const { user } = useSession();
  const route = useRoute();
  const [section, id] = route.parts;
  const canEdit = hasRole(user?.role, 'editor');
  const isAdmin = hasRole(user?.role, 'admin');

  let page: ReactNode;
  switch (section ?? '') {
    case '':
      page = <CollectionPage />;
      break;
    case 'item':
      page = <ItemPage key={id} id={id} />;
      break;
    case 'card':
      page = <CardPage key={id} cardId={id} />;
      break;
    case 'add':
      page = (
        <AddPage
          key={route.query.get('q') ?? ''}
          tab={id === 'scan' || id === 'list' ? id : 'search'}
          initialQuery={route.query.get('q') ?? ''}
        />
      );
      break;
    case 'sets':
      page = <SetsPage />;
      break;
    case 'set':
      page = <SetPage key={id} id={id} />;
      break;
    case 'artists':
      page = <ArtistsPage />;
      break;
    case 'artist':
      page = <ArtistPage key={id} name={id} />;
      break;
    case 'binders':
      page = <BindersPage />;
      break;
    case 'binder':
      if (route.parts[2] !== 'edit') page = <BinderPage key={id} id={id} />;
      else page = canEdit ? <BinderEditPage key={id} id={id} /> : <NotAllowed />;
      break;
    case 'trash':
      page = canEdit ? <TrashPage /> : <NotAllowed />;
      break;
    case 'admin':
      page = isAdmin ? <AdminPage /> : <NotAllowed />;
      break;
    case 'account':
      page = <AccountPage />;
      break;
    default:
      page = <div className="page"><h1>Not found</h1><a href="#/">Go to the collection</a></div>;
  }

  const tab = (to: string, label: string, icon: ReactNode, active: boolean) => (
    <a href={to} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
      {icon}
      <span>{label}</span>
    </a>
  );

  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="logo">
          <img src="./icons/icon.svg" alt="" width={28} height={28} />
          PokéVault
        </a>
        <span className="who">{user?.displayName}</span>
      </header>
      <main>{page}</main>
      <nav className="tabbar" aria-label="Main">
        {tab('#/', 'Collection', <IconCards />, !section || section === 'item')}
        {tab('#/sets', 'Sets', <IconSets />, ['sets', 'set', 'binders', 'binder'].includes(section ?? ''))}
        {canEdit && tab(href('add', 'scan'), 'Add', <IconPlus />, section === 'add' || section === 'card')}
        {tab('#/artists', 'Artists', <IconBrush />, section === 'artists' || section === 'artist')}
        {isAdmin && tab('#/admin', 'Admin', <IconShield />, section === 'admin')}
        {tab('#/account', 'Account', <IconUser />, section === 'account')}
      </nav>
    </div>
  );
}

function NotAllowed() {
  return (
    <div className="page">
      <h1>Not allowed</h1>
      <p className="muted">Your role doesn't include this page. Ask an admin if you need more access.</p>
    </div>
  );
}
