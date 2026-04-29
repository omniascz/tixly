import { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatCardProps {
  title: string;
  value: string;
  trend?: number;
  hint?: string;
  icon?: ReactNode;
}

export function StatCard({ title, value, trend, hint, icon }: StatCardProps) {
  const trendUp = typeof trend === 'number' && trend >= 0;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </CardTitle>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          {typeof trend === 'number' && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-medium',
                trendUp ? 'text-emerald-600' : 'text-rose-600',
              )}
            >
              {trendUp ? (
                <ArrowUpRight className="h-3 w-3" aria-hidden />
              ) : (
                <ArrowDownRight className="h-3 w-3" aria-hidden />
              )}
              {Math.abs(trend).toFixed(1)} %
            </span>
          )}
          {hint && <span>{hint}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
