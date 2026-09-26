import { useCallback, useEffect, useRef, useState } from 'react';
import { iris } from './api';
export function useData<T = any>(path: string, query: Record<string, string> = {}, interval = 0) {
  const [data, setData] = useState<T>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [at, setAt] = useState<Date>(),
    [version, setVersion] = useState(0);
  const sequence = useRef(0),
    key = JSON.stringify(query);
  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    let live = true;
    const load = async () => {
      const id = ++sequence.current;
      setLoading(true);
      try {
        const result = await iris<T>(path, JSON.parse(key));
        if (live && id === sequence.current) {
          setData(result.data);
          setError('');
          setAt(new Date());
        }
      } catch (e) {
        if (live && id === sequence.current) setError((e as Error).message);
      } finally {
        if (live && id === sequence.current) setLoading(false);
      }
    };
    setData(undefined);
    void load();
    const timer = interval
      ? setInterval(() => {
          if (!document.hidden) void load();
        }, interval)
      : undefined;
    return () => {
      live = false;
      if (timer) clearInterval(timer);
    };
  }, [path, key, version, interval]);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, loading, at, refresh };
}
