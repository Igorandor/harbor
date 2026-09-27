import { useCallback, useEffect, useRef, useState } from 'react';
import { iris, RequestError } from './api';
export function useData<T = any>(path: string, query: Record<string, string> = {}, interval = 0) {
  const key = JSON.stringify(query),
    source = JSON.stringify([path, key]);
  const [data, setData] = useState<T>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [at, setAt] = useState<Date>(),
    [version, setVersion] = useState(0),
    [owner, setOwner] = useState(source);
  const sequence = useRef(0);
  useEffect(() => {
    setOwner(source);
    setData(undefined);
    setAt(undefined);
    setError('');
  }, [source]);
  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    let live = true;
    const load = async () => {
      if (!live) return;
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
        if (live && id === sequence.current) {
          if (e instanceof RequestError && e.status === 403) {
            setData(undefined);
            setAt(undefined);
          }
          setError((e as Error).message);
        }
      } finally {
        if (live && id === sequence.current) setLoading(false);
      }
    };
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
  const current = !!path && owner === source;
  return {
    data: current ? data : undefined,
    error: current ? error : '',
    loading: !path ? false : owner === source ? loading : true,
    at: current ? at : undefined,
    refresh,
  };
}
