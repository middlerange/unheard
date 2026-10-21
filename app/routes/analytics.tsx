// ABOUTME: Analytics route retained for existing bookmarks and navigation.

import { createFileRoute } from '@tanstack/react-router';
import { DashboardPage } from '@/components/dashboard/DashboardPage';

export const Route = createFileRoute('/analytics')({ component: DashboardPage });
