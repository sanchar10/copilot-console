interface TokenUsageSliderProps {
  tokenLimit?: number;
  currentTokens?: number;
  messagesLength?: number;
  isActive: boolean; // Whether streaming is currently active
}

export function TokenUsageSlider({ 
  tokenLimit, 
  currentTokens, 
  messagesLength, 
  isActive: _isActive 
}: TokenUsageSliderProps) {
  // Show gray/disabled bar only when no token data exists
  // Keep colored bar after streaming ends to show final usage
  if (!tokenLimit || currentTokens === undefined) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-white/50 dark:bg-[#2a2a3c]/50 backdrop-blur rounded-lg border border-gray-200/60 dark:border-gray-700 w-56">
        <span className="text-xs font-medium text-gray-400">Tokens</span>
        <div className="flex-1 h-2 bg-white/60 dark:bg-gray-700 rounded-full" />
        <span className="text-xs text-gray-400 w-8 text-right">-</span>
      </div>
    );
  }

  const percentage = (currentTokens / tokenLimit) * 100;
  const isOverHalf = percentage >= 50;
  const barColor = isOverHalf ? 'bg-orange-500' : 'bg-green-500';
  const textColor = isOverHalf ? 'text-orange-700 dark:text-orange-400' : 'text-green-700 dark:text-green-400';

  return (
    <div 
      className="flex items-center gap-2 px-3 py-1.5 bg-white/50 dark:bg-[#2a2a3c]/50 backdrop-blur rounded-lg border border-gray-200/60 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition-colors w-56"
      title={`Token usage: ${currentTokens.toLocaleString()} / ${tokenLimit.toLocaleString()}\nMessages: ${messagesLength || 0}`}
    >
      <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Tokens</span>
      <div className="flex-1 h-2 bg-white/60 dark:bg-gray-700 rounded-full overflow-hidden">
        <div 
          className={`h-full ${barColor} transition-all duration-300 ease-out`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
      <span className={`text-xs font-medium ${textColor} w-8 text-right`}>
        {percentage.toFixed(0)}%
      </span>
    </div>
  );
}

