import type { AdvancedFilterTab } from './filterTypes';

type TabDef = {
  id: AdvancedFilterTab;
  label: string;
};

type AdvancedFilterTabsProps = {
  tabs: readonly TabDef[];
  activeTab: AdvancedFilterTab;
  onChange: (tab: AdvancedFilterTab) => void;
};

export default function AdvancedFilterTabs({ tabs, activeTab, onChange }: AdvancedFilterTabsProps) {
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max gap-2">
        {tabs?.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'border-indigo-500 bg-indigo-600 text-white'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
