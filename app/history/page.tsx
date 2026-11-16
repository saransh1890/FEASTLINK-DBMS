
'use client';

import AppShell from '@/components/AppShell';
import { useEffect, useState } from 'react';
import {
  HeartHandshake,
  Plus,
  Users,
  Utensils
} from 'lucide-react';

export default function History() {
  const [rows, setRows] = useState<any[]>([]);
  const [role, setRole] = useState('');
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const [a, b] = await Promise.all([
        fetch('/api/history'),
        fetch('/api/deliveries')
      ]);

      const x = await a.json();
      const y = await b.json();

      setRows(x.history || []);

      setDeliveries(
        (y.deliveries || []).filter(
          (d: any) => d.delivery_status === 'DELIVERED'
        )
      );
    } catch {
      setMsg('Unable to load donation history.');
    }
  }

  useEffect(() => {
    load();

    fetch('/api/auth/me')
      .then(r => r.json())
      .then(d => setRole(d.user?.role || ''))
      .catch(() => setRole(''));
  }, []);

  async function record(e: any) {
    e.preventDefault();

    const form = e.currentTarget;
    if (saving) return;

    setSaving(true);
    setMsg('');

    try {
      const fd = new FormData(form);

      const r = await fetch('/api/history', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          allocationId: Number(fd.get('allocationId')),
          mealsServed: Number(fd.get('mealsServed')),
          beneficiaryCount: Number(fd.get('beneficiaryCount')),
          remarks: fd.get('remarks')
        })
      });

      const d = await r.json();

      if (!r.ok) {
        setMsg(d.error || 'Unable to record donation impact.');
        return;
      }

      setMsg('Donation impact recorded successfully.');
      form.reset();
      await load();

    } catch {
      setMsg('Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const total = rows.reduce(
    (a, r) => a + Number(r.meals_served),
    0
  );

  const people = rows.reduce(
    (a, r) => a + Number(r.beneficiary_count || 0),
    0
  );

  // Exclude allocations that already have a donation record.
  const recordedAllocationIds = new Set(
    rows.map((r: any) => Number(r.allocation_id))
  );

  const eligibleDeliveries = deliveries.filter(
    (d: any) =>
      !recordedAllocationIds.has(Number(d.allocation_id))
  );

  return (
    <AppShell>
      <div className="page-title-row">
        <div>
          <span className="eyebrow">THE GOOD WE DO TOGETHER</span>
          <h1>Impact <i>history.</i></h1>
          <p className="muted">
            Every meal shared is a story worth counting.
          </p>
        </div>

        <div className="title-icon">
          <HeartHandshake />
        </div>
      </div>

      <div className="impact-summary">
        <div>
          <Utensils />
          <b>{total.toLocaleString('en-IN')}</b>
          <span>Meals served</span>
        </div>

        <div>
          <Users />
          <b>{people.toLocaleString('en-IN')}</b>
          <span>People reached</span>
        </div>

        <div>
          <HeartHandshake />
          <b>{rows.length}</b>
          <span>Completed donations</span>
        </div>
      </div>

      {msg && <div className="alert success">{msg}</div>}

      {role === 'SHELTER_ADMIN' &&
        eligibleDeliveries.length > 0 && (
          <form
            className="panel record-form"
            onSubmit={record}
          >
            <div className="panel-heading">
              <div>
                <span className="eyebrow">CLOSE THE LOOP</span>
                <h3>Record a donation</h3>
                <p className="muted">
                  Confirm how many meals reached beneficiaries.
                </p>
              </div>

              <span className="record-icon">
                <Plus />
              </span>
            </div>

            <div className="form-grid">
              <div className="span-2">
                <label>Delivered allocation *</label>

                <select name="allocationId" required>
                  {eligibleDeliveries.map((d: any) => (
                    <option
                      key={d.allocation_id}
                      value={d.allocation_id}
                    >
                      #{d.allocation_id} · {d.food_name} ·{' '}
                      {d.allocated_meals} meals
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label>Meals served *</label>
                <input
                  name="mealsServed"
                  type="number"
                  min="0"
                  required
                  placeholder="e.g. 45"
                />
              </div>

              <div>
                <label>Beneficiaries *</label>
                <input
                  name="beneficiaryCount"
                  type="number"
                  min="0"
                  required
                  placeholder="e.g. 40"
                />
              </div>

              <div className="span-2">
                <label>Remarks</label>
                <input
                  name="remarks"
                  placeholder="Optional notes about the donation"
                />
              </div>
            </div>

            <button
              className="btn primary"
              type="submit"
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save donation impact'}
            </button>
          </form>
        )}

      {rows.length > 0 ? (
        <div className="panel table-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">DONATION RECORDS</span>
              <h3>What we've made possible</h3>
            </div>
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>FOOD / EVENT</th>
                  <th>SHELTER</th>
                  <th>MEALS SERVED</th>
                  <th>BENEFICIARIES</th>
                  <th>COMPLETED</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.donation_id}>
                    <td>
                      <b>{r.food_name}</b>
                      <small>{r.event_name}</small>
                    </td>

                    <td>{r.shelter_name}</td>
                    <td><b>{r.meals_served}</b></td>
                    <td>{r.beneficiary_count ?? '—'}</td>

                    <td>
                      {new Date(
                        r.completion_date
                      ).toLocaleDateString('en-IN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="panel empty-large">
          <HeartHandshake />
          <h3>Your impact story starts here</h3>
          <p>
            Completed donations will appear here once shelters
            record the meals served.
          </p>
        </div>
      )}
    </AppShell>
  );
}

