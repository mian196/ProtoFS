import React from 'react';
import { ChevronRight, HardDrive, ArrowUp } from 'lucide-react';
import { useVfsStore } from '../../stores/useVfsStore';

export const BreadcrumbBar: React.FC = () => {
  const { breadcrumbs, navigateToBreadcrumb, navigateUp } = useVfsStore();

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1 text-sm overflow-x-auto no-scrollbar py-0.5"
    >
      {breadcrumbs.length > 1 && (
        <button
          type="button"
          onClick={navigateUp}
          title="Go to parent directory (Backspace)"
          className="p-1 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors mr-0.5 cursor-pointer"
        >
          <ArrowUp className="w-3.5 h-3.5" />
        </button>
      )}

      {breadcrumbs.map((item, index) => {
        const isLast = index === breadcrumbs.length - 1;
        return (
          <React.Fragment key={item.id}>
            {index > 0 && (
              <ChevronRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-600 shrink-0" />
            )}
            <button
              type="button"
              onClick={() => navigateToBreadcrumb(index)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                isLast
                  ? 'bg-sky-500/12 text-sky-700 dark:text-sky-300 font-semibold border border-sky-500/25'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5'
              }`}
            >
              {index === 0 && <HardDrive className="w-3.5 h-3.5 shrink-0 text-sky-500" />}
              <span className="truncate max-w-[150px]">{item.name}</span>
            </button>
          </React.Fragment>
        );
      })}
    </nav>
  );
};
