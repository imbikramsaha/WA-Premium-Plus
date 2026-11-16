import { useEffect, useState } from 'react';
import type { ConnectionState } from '../../shared/types';
import { ConnectScreen } from './components/ConnectScreen';
import { MainScreen } from './components/MainScreen';
import { useExtras } from './extras';

export function App() {
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  // Switching accounts remounts everything, so each account's screens start fresh.
  const [accountKey, setAccountKey] = useState(0);
  const extras = useExtras();

  useEffect(() => {
    const off = window.wapp.onEvent((event) => {
      if (event.type === 'connection') setConnection(event.state);
      if (event.type === 'account-switched') {
        void window.wapp.getConnection().then((state) => {
          setConnection(state);
          setAccountKey((k) => k + 1);
        });
      }
    });
    void window.wapp.getConnection().then((state) => setConnection((current) => current ?? state));
    return off;
  }, []);

  if (!connection) {
    return (
      <main className="center-screen">
        <div className="spinner" />
      </main>
    );
  }
  return connection.linked ? (
    <MainScreen key={accountKey} connection={connection} extras={extras} />
  ) : (
    <ConnectScreen key={accountKey} state={connection} />
  );
}
