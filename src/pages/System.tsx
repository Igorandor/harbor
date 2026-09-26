import { useEffect, useRef, useState } from 'react';
import { Cpu, HardDrive, MemoryStick, Timer } from 'lucide-react';
import { entities } from '../../shared/catalog';
import { useData } from '../hooks';
import { ErrorBox, PageHeader, Refresh } from '../components/ui';
import { Collection } from './Collection';
import { Metric } from './Overview';
const gb = (n: number) => (Number.isFinite(n) ? (n / 1024 ** 3).toFixed(1) + ' GB' : '—');
export function System({ info, notify }: { info: any; notify: (s: string) => void }) {
  const [tab, setTab] = useState('processes'),
    state = useData('/extension/telemetry', {}, 10000),
    previous = useRef<any>(undefined),
    [cpu, setCpu] = useState<number>();
  useEffect(() => {
    const next = state.data?.cpu,
      old = previous.current;
    if (next && old && next.totalTicks > old.totalTicks)
      setCpu(
        Math.max(
          0,
          Math.min(
            100,
            100 * (1 - (next.idleTicks - old.idleTicks) / (next.totalTicks - old.totalTicks)),
          ),
        ),
      );
    previous.current = next;
  }, [state.data]);
  const d = state.data;
  return (
    <>
      <PageHeader
        eyebrow="Infrastructure"
        title="System resources"
        description="Host capacity and the processes doing the work."
      >
        <Refresh loading={state.loading} onClick={state.refresh} at={state.at} />
      </PageHeader>
      {state.error ? (
        <ErrorBox
          error={
            state.error +
            ' Install the included Harbor extension for host telemetry; native process and device APIs remain available.'
          }
          retry={state.refresh}
        />
      ) : (
        <div className="metric-grid">
          <Metric
            icon={<Cpu size={19} />}
            title="CPU utilization"
            value={cpu === undefined ? 'Sampling…' : cpu.toFixed(1) + '%'}
            note={`${d?.cpu?.logicalCount ?? '—'} logical CPUs · 10 sec interval`}
          />
          <Metric
            icon={<MemoryStick size={19} />}
            title="Memory used"
            value={d?.memory ? gb(d.memory.total - d.memory.available) : '—'}
            note={d?.memory ? `of ${gb(d.memory.total)} host memory` : 'Waiting for host sample'}
          />
          <Metric
            icon={<HardDrive size={19} />}
            title="Disk available"
            value={d?.disk ? gb(d.disk.free) : '—'}
            note={
              d?.disk ? `of ${gb(d.disk.total)} · IRIS manager volume` : 'Waiting for host sample'
            }
          />
          <Metric
            icon={<Timer size={19} />}
            title="Load average · 1 min"
            value={d?.cpu?.loadAverage?.[0]?.toFixed(2) ?? '—'}
            note="Runnable or waiting processes"
          />
        </div>
      )}
      <p className="scope-note">
        {d?.scope ?? 'Telemetry is collected inside the IRIS host using Embedded Python.'}{' '}
        {d?.notice}
      </p>
      <div className="tabs" aria-label="System views">
        {['processes', 'devices', 'databases'].map((id) => (
          <button
            key={id}
            aria-pressed={tab === id}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
          >
            {entities[id].title}
          </button>
        ))}
      </div>
      <Collection key={tab} entity={entities[tab]} info={info} notify={notify} />
    </>
  );
}
