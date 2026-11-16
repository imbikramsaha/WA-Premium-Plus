import { useEffect, useState } from 'react';
import type { ConnectionState } from '../../shared/types';
import { ConnectScreen } from './components/ConnectScreen';
import { MainScreen } from './components/MainScreen';

export function App() {
  const [connection, setConnection] = useState<ConnectionState | null>(null);

  useEffect(() => {
    const off = window.wapp.onEvent((event) => {
      if (event.type === 'connection') setConnection(event.state);
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
  return connection.linked ? <MainScreen connection={connection} /> : <ConnectScreen state={connection} />;
}
