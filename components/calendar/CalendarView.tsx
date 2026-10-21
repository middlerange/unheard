// ABOUTME: Multi-view calendar (day/week/month) for viewing and managing scheduled posts.
// ABOUTME: Week is the default view; hourly slots show a + button on hover to create a post.

'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import { ChevronLeft, ChevronRight, Plus } from "@/components/icons";
import { Button } from '@/components/ui/button';
import { PostCard } from './PostCard';
import { cn } from '@/lib/utils';
import type { PostWithDetails } from '@/lib/db/types';

type ViewType = 'day' | 'week' | 'month';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

interface CalendarViewProps {
  posts: PostWithDetails[];
  onNewPost: (date: Date) => void;
  onEditPost: (post: PostWithDetails) => void;
}

export function CalendarView({ posts, onNewPost, onEditPost }: CalendarViewProps) {
  const [view, setView] = useState<ViewType>('week');
  const [current, setCurrent] = useState(() => dayjs());

  function navigate(dir: 1 | -1) {
    const unit = view === 'day' ? 'day' : view === 'week' ? 'week' : 'month';
    setCurrent(c => c.add(dir, unit));
  }

  const headerLabel = useMemo(() => {
    if (view === 'month') return current.format('MMMM YYYY');
    if (view === 'week') {
      const start = isoWeekStart(current);
      const end = start.add(6, 'day');
      return `${start.format('MM/DD/YYYY')} – ${end.format('MM/DD/YYYY')}`;
    }
    return current.format('MMMM D, YYYY');
  }, [view, current]);

  return (
    <div className="flex flex-col h-full select-none">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => navigate(-1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-medium w-52 text-center">{headerLabel}</span>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => navigate(1)}>
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" className="text-xs h-8" onClick={() => setCurrent(dayjs())}>
            Today
          </Button>
        </div>

        <div className="flex items-center border border-border rounded-md overflow-hidden">
          {(['Day', 'Week', 'Month'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v.toLowerCase() as ViewType)}
              className={cn(
                'px-4 h-8 text-xs font-medium transition-colors',
                view === v.toLowerCase()
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {view === 'month' && (
          <MonthView
            current={current.startOf('month')}
            posts={posts}
            onNewPost={onNewPost}
            onEditPost={onEditPost}
          />
        )}
        {view === 'week' && (
          <WeekView
            current={current}
            posts={posts}
            onNewPost={onNewPost}
            onEditPost={onEditPost}
          />
        )}
        {view === 'day' && (
          <DayView
            current={current}
            posts={posts}
            onNewPost={onNewPost}
            onEditPost={onEditPost}
          />
        )}
      </div>
    </div>
  );
}

// ─── Week View ────────────────────────────────────────────────────────────────

function WeekView({
  current,
  posts,
  onNewPost,
  onEditPost,
}: {
  current: Dayjs;
  posts: PostWithDetails[];
  onNewPost: (date: Date) => void;
  onEditPost: (post: PostWithDetails) => void;
}) {
  const [now, setNow] = useState(() => dayjs());

  useEffect(() => {
    const id = setInterval(() => setNow(dayjs()), 60_000);
    return () => clearInterval(id);
  }, []);

  const weekDays = useMemo(() => {
    const start = isoWeekStart(current);
    return Array.from({ length: 7 }, (_, i) => start.add(i, 'day'));
  }, [current]);

  const postsBySlot = useMemo(() => buildSlotMap(posts), [posts]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      const hour8 = scrollRef.current.querySelector('[data-hour="8"]') as HTMLElement | null;
      hour8?.scrollIntoView({ block: 'start' });
    }
  }, []);

  const today = now;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex border-b border-border shrink-0">
        <div className="w-16 shrink-0" />
        {weekDays.map(day => {
          const isToday = day.isSame(today, 'day');
          return (
            <div
              key={day.format('YYYY-MM-DD')}
              className="flex-1 py-2 text-center border-l border-border"
            >
              <div className="text-xs text-muted-foreground">{DAY_LABELS[(day.day() + 6) % 7]}</div>
              <div
                className={cn(
                  'text-xs font-semibold mt-0.5',
                  isToday ? 'text-[var(--color-brand)]' : 'text-foreground',
                )}
              >
                {isToday && <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mr-1 mb-px" />}
                {day.format('MM/DD/YYYY')}
              </div>
            </div>
          );
        })}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {HOURS.map(hour => (
          <div key={hour} data-hour={hour} className="flex border-b border-border" style={{ minHeight: 64 }}>
            <div className="w-16 shrink-0 px-2 pt-1 text-right text-xs text-muted-foreground">
              {formatHour(hour)}
            </div>
            {weekDays.map(day => {
              const isPast = day.isBefore(today, 'day');
              const key = `${day.format('YYYY-MM-DD')}-${hour}`;
              const slotPosts = postsBySlot.get(key) ?? [];
              const isToday = day.isSame(today, 'day');

              return (
                <HourCell
                  key={day.format('YYYY-MM-DD')}
                  isPast={isPast}
                  posts={slotPosts}
                  onNewPost={() => onNewPost(day.hour(hour).minute(0).second(0).toDate())}
                  onEditPost={onEditPost}
                  showCurrentTimeLine={isToday && hour === now.hour()}
                  currentMinutes={now.minute()}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Day View ─────────────────────────────────────────────────────────────────

function DayView({
  current,
  posts,
  onNewPost,
  onEditPost,
}: {
  current: Dayjs;
  posts: PostWithDetails[];
  onNewPost: (date: Date) => void;
  onEditPost: (post: PostWithDetails) => void;
}) {
  const [now, setNow] = useState(() => dayjs());
  const postsBySlot = useMemo(() => buildSlotMap(posts), [posts]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const today = now;

  useEffect(() => {
    const id = setInterval(() => setNow(dayjs()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      const hour8 = scrollRef.current.querySelector('[data-hour="8"]') as HTMLElement | null;
      hour8?.scrollIntoView({ block: 'start' });
    }
  }, []);

  const isToday = current.isSame(today, 'day');
  const isPast = current.isBefore(today, 'day');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex border-b border-border shrink-0">
        <div className="w-16 shrink-0" />
        <div className="flex-1 py-2 text-center border-l border-border">
          <div className="text-xs text-muted-foreground">{current.format('dddd')}</div>
          <div className={cn('text-xs font-semibold mt-0.5', isToday ? 'text-[var(--color-brand)]' : 'text-foreground')}>
            {isToday && <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mr-1 mb-px" />}
            {current.format('MM/DD/YYYY')}
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {HOURS.map(hour => {
          const key = `${current.format('YYYY-MM-DD')}-${hour}`;
          const slotPosts = postsBySlot.get(key) ?? [];
          return (
            <div key={hour} data-hour={hour} className="flex border-b border-border" style={{ minHeight: 64 }}>
              <div className="w-16 shrink-0 px-2 pt-1 text-right text-xs text-muted-foreground">
                {formatHour(hour)}
              </div>
              <HourCell
                isPast={isPast}
                posts={slotPosts}
                onNewPost={() => onNewPost(current.hour(hour).minute(0).second(0).toDate())}
                onEditPost={onEditPost}
                showCurrentTimeLine={isToday && hour === now.hour()}
                currentMinutes={now.minute()}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Hour Cell ────────────────────────────────────────────────────────────────

function HourCell({
  isPast,
  posts,
  onNewPost,
  onEditPost,
  showCurrentTimeLine,
  currentMinutes,
}: {
  isPast: boolean;
  posts: PostWithDetails[];
  onNewPost: () => void;
  onEditPost: (post: PostWithDetails) => void;
  showCurrentTimeLine?: boolean;
  currentMinutes?: number;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="flex-1 border-l border-border p-1 relative group"
      style={isPast ? { background: 'repeating-linear-gradient(135deg, transparent, transparent 4px, rgba(0,0,0,0.03) 4px, rgba(0,0,0,0.03) 8px)' } : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {showCurrentTimeLine && (
        <div
          className="absolute left-0 right-0 h-px bg-primary z-10 pointer-events-none"
          style={{ top: `${((currentMinutes ?? 0) / 60) * 100}%` }}
        />
      )}
      {posts.map(post => (
        <PostCard key={post.id} post={post} onClick={() => onEditPost(post)} compact />
      ))}
      {hovered && posts.length === 0 && (
        <button
          onClick={onNewPost}
          className="absolute inset-0 flex items-center justify-center"
        >
          <span className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center hover:bg-primary/80 transition-colors">
            <Plus className="w-4 h-4 text-primary-foreground" />
          </span>
        </button>
      )}
    </div>
  );
}

// ─── Month View ───────────────────────────────────────────────────────────────

function MonthView({
  current,
  posts,
  onNewPost,
  onEditPost,
}: {
  current: Dayjs;
  posts: PostWithDetails[];
  onNewPost: (date: Date) => void;
  onEditPost: (post: PostWithDetails) => void;
}) {
  const days = useMemo(() => buildMonthDays(current), [current]);

  const postsByDay = useMemo(() => {
    const map = new Map<string, PostWithDetails[]>();
    for (const post of posts) {
      const key = post.publish_at
        ? dayjs(post.publish_at).format('YYYY-MM-DD')
        : dayjs(post.created_at).format('YYYY-MM-DD');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(post);
    }
    return map;
  }, [posts]);

  return (
    <div className="flex flex-col h-full">
      <div className="grid grid-cols-7 border-b border-border">
        {MONTH_DAYS.map(d => (
          <div key={d} className="py-2 text-center text-xs font-medium text-muted-foreground">
            {d}
          </div>
        ))}
      </div>
      <div className="flex-1 grid grid-cols-7 auto-rows-fr overflow-auto">
        {days.map((day, i) => {
          const key = day.format('YYYY-MM-DD');
          const dayPosts = postsByDay.get(key) ?? [];
          const isToday = day.isSame(dayjs(), 'day');
          const isCurrentMonth = day.month() === current.month();

          return (
            <MonthDayCell
              key={i}
              day={day}
              posts={dayPosts}
              isToday={isToday}
              isCurrentMonth={isCurrentMonth}
              onNewPost={() => onNewPost(day.toDate())}
              onEditPost={onEditPost}
            />
          );
        })}
      </div>
    </div>
  );
}

function MonthDayCell({
  day,
  posts,
  isToday,
  isCurrentMonth,
  onNewPost,
  onEditPost,
}: {
  day: Dayjs;
  posts: PostWithDetails[];
  isToday: boolean;
  isCurrentMonth: boolean;
  onNewPost: () => void;
  onEditPost: (post: PostWithDetails) => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className={cn(
        'min-h-[120px] border-b border-r border-border p-1.5 flex flex-col gap-1 transition-colors group',
        !isCurrentMonth && 'opacity-40',
        hovered && 'bg-accent/20',
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-center justify-between mb-0.5">
        <span
          className={cn(
            'text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full',
            isToday ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
          )}
        >
          {day.date()}
        </span>
        <button onClick={onNewPost} className="opacity-0 group-hover:opacity-100 transition-opacity">
          <Plus className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
        </button>
      </div>
      <div className="flex flex-col gap-1 overflow-hidden">
        {posts.slice(0, 3).map(post => (
          <PostCard key={post.id} post={post} onClick={() => onEditPost(post)} compact />
        ))}
        {posts.length > 3 && (
          <span className="text-[10px] text-muted-foreground px-1">+{posts.length - 3} more</span>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isoWeekStart(date: Dayjs): Dayjs {
  const offset = (date.day() + 6) % 7;
  return date.subtract(offset, 'day').startOf('day');
}

function formatHour(hour: number): string {
  if (hour === 0) return '12:00 AM';
  if (hour < 12) return `${hour}:00 AM`;
  if (hour === 12) return '12:00 PM';
  return `${hour - 12}:00 PM`;
}

function buildSlotMap(posts: PostWithDetails[]): Map<string, PostWithDetails[]> {
  const map = new Map<string, PostWithDetails[]>();
  for (const post of posts) {
    const dt = post.publish_at ? dayjs(post.publish_at) : dayjs(post.created_at);
    const key = `${dt.format('YYYY-MM-DD')}-${dt.hour()}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(post);
  }
  return map;
}

function buildMonthDays(month: Dayjs): Dayjs[] {
  const start = month.startOf('month').startOf('week');
  const end = month.endOf('month').endOf('week');
  const days: Dayjs[] = [];
  let cur = start;
  while (cur.isBefore(end) || cur.isSame(end, 'day')) {
    days.push(cur);
    cur = cur.add(1, 'day');
  }
  return days;
}
