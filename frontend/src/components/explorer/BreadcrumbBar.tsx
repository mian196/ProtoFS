import React from 'react';
import { ChevronRight, HardDrive, ArrowUp } from 'lucide-react';
import { useVfsStore } from '../../stores/useVfsStore';

export const BreadcrumbBar: React.FC = () => {
  const { breadcrumbs, navigateToBreadcrumb, navigateUp } = useVfsStore();

  return (
    <div className="flex items-center gap-1.5 text-sm overflow-x-auto no-scrollbar py-1">
      {breadcrumbs.length > 1 && (
        <button
          onClick={navigateUp}
          title="Go to parent directory"
          className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors mr-1"
        >
          <ArrowUp className="w-4 h-4" />
        </button>
      )}

      {breadcrumbs.map((item, index) => {
        const isLast = index === breadcrumbs.length - 1;
        return (
          <React.Fragment key={item.id}>
            {index > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />}
            <button
              onClick={() => navigateToBreadcrumb(index)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                isLast
                  ? 'bg-sky-500/10 text-sky-400 font-semibold border border-sky-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              {index === 0 && <HardDrive className="w-3.5 h-3.5 shrink-0" />}
              <span className="truncate max-w-[140px]">{item.name}</span>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
};
