
'use client';

import AppShell from '@/components/AppShell';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  Utensils,
  ClipboardList,
  HeartHandshake,
  Users,
  Plus,
  MapPin,
  Sparkles
} from 'lucide-react';

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [user, setUser] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadDashboard() {
      try {
        const response = await fetch('/api/dashboard');
        const result = await response.json();

        console.log('DASHBOARD DATA:', result);

        if (!response.ok) {
          throw new Error(result.error || 'Dashboard loading failed');
        }

        setData(result);
      } catch (err: any) {
        console.error('Dashboard fetch error:', err);
        setError(err.message || 'Unable to load dashboard');
      }
    }

    async function loadUser() {
      try {
        const response = await fetch('/api/auth/me');
        const result = await response.json();

        console.log('AUTH DATA:', result);

        if (response.ok) {
          setUser(result.user);
        }
      } catch (err) {
        console.error('Auth fetch error:', err);
      }
    }

    loadDashboard();
    loadUser();
  }, []);

  const s = data?.stats || {};

  return (
    <AppShell>
      <div className="welcome-row">
        <div>
          <span className="eyebrow">
            YOUR IMPACT, AT A GLANCE
          </span>

          <h1>
            Good things are <i>happening.</i>
          </h1>

          <p className="muted">
            Here's what's moving in your FeastLink community.
          </p>
        </div>

        <div className="date-chip">
          <Sparkles size={15} />
          Together, we make a difference
        </div>
      </div>

      <div className="hero-banner">
        <div>
          <span className="eyebrow light">
            THE FEASTLINK PROMISE
          </span>

          <h2>
            Every plate has<br />
            the power to <i>matter.</i>
          </h2>

          <p>
            Make surplus food someone's next good meal.
          </p>
        </div>

        <div className="hero-illustration">
          <div className="plate plate-one">🥗</div>
          <div className="plate plate-two">🍲</div>
          <div className="hero-leaf">✳</div>
        </div>

        <span className="hero-orb orb-a" />
        <span className="hero-orb orb-b" />
      </div>

      <div className="section-heading">
        <div>
          <span className="eyebrow">YOUR OVERVIEW</span>
          <h2>Impact dashboard</h2>
        </div>

        <Link className="text-link" href="/history">
          View impact history <ArrowUpRight size={16} />
        </Link>
      </div>

      {error && (
        <div className="alert">
          {error}
        </div>
      )}

      <div className="stats-grid">
        <Stat
          icon={<Utensils />}
          label="Food listings"
          value={data ? s.foodListings : 'Loading...'}
          detail="Surplus shared"
        />

        <Stat
          icon={<ClipboardList />}
          label="Food requests"
          value={data ? s.requests : 'Loading...'}
          detail={`${s.pending ?? 0} awaiting action`}
        />

        <Stat
          icon={<HeartHandshake />}
          label="Meals served"
          value={data ? s.mealsServed : 'Loading...'}
          detail="Confirmed donations"
        />

        <Stat
          icon={<Users />}
          label="People reached"
          value={data ? s.beneficiaries : 'Loading...'}
          detail="Beneficiaries fed"
        />
      </div>

      <div className="dashboard-columns">
        <section className="panel recent-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">LATEST ACTIVITY</span>

              <h3>
                {user?.role === 'SHELTER_ADMIN'
                  ? 'Food available nearby'
                  : 'Your recent food listings'}
              </h3>
            </div>

            <Link href="/food" className="text-link">
              See all <ArrowUpRight size={15} />
            </Link>
          </div>

          {!data ? (
            <div className="empty-state">
              Loading your activity…
            </div>
          ) : data.recent?.length ? (
            data.recent.map((f: any) => (
              <div className="food-row" key={f.food_id}>
                <div className="food-thumb">
                  {f.food_type === 'NON_VEG' ? '🍛' : '🥘'}
                </div>

                <div className="food-info">
                  <b>{f.food_name}</b>

                  <span>
                    {f.event_name} · <MapPin size={12} /> {f.location}
                  </span>
                </div>

                <div className="food-quantity">
                  <b>{f.available_meals}</b>
                  <small>meals available</small>
                </div>

                <Status value={f.status} />
              </div>
            ))
          ) : (
            <div className="empty-state">
              No listings yet. Start by sharing surplus food.
            </div>
          )}
        </section>

        <section className="panel quick-panel">
          <span className="eyebrow">QUICK ACTIONS</span>

          <h3>Make something happen.</h3>

          <p className="muted">
            A small step can make a big difference.
          </p>

          {user?.role === 'ORGANIZER' && (
            <Link href="/food/new" className="quick-action">
              <span className="quick-icon">
                <Plus />
              </span>

              <span>
                <b>Share surplus food</b>
                <small>List food from your event</small>
              </span>

              <ArrowUpRight />
            </Link>
          )}

          {user?.role === 'SHELTER_ADMIN' && (
            <Link href="/food" className="quick-action">
              <span className="quick-icon">
                <Utensils />
              </span>

              <span>
                <b>Find available food</b>
                <small>Browse nearby donations</small>
              </span>

              <ArrowUpRight />
            </Link>
          )}

          <Link href="/requests" className="quick-action">
            <span className="quick-icon">
              <ClipboardList />
            </span>

            <span>
              <b>Manage requests</b>
              <small>Track requests and approvals</small>
            </span>

            <ArrowUpRight />
          </Link>

          <Link href="/deliveries" className="quick-action">
            <span className="quick-icon">
              <HeartHandshake />
            </span>

            <span>
              <b>Track deliveries</b>
              <small>Follow every handoff</small>
            </span>

            <ArrowUpRight />
          </Link>

          <div className="quote-card">
            “No one should go hungry when good food goes to waste.”
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function Stat({ icon, label, value, detail }: any) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span className="stat-icon">{icon}</span>
        <span className="stat-dots">•••</span>
      </div>

      <b className="stat-value">{value}</b>

      <span className="stat-label">{label}</span>

      <small>{detail}</small>
    </div>
  );
}

export function Status({ value }: any) {
  return (
    <span className={`status status-${String(value).toLowerCase()}`}>
      {String(value).replace('_', ' ')}
    </span>
  );
}
