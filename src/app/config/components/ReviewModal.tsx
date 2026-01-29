'use client';

import React, { useMemo } from 'react';
import { AppConfig } from '../types';
import _ from 'lodash';

interface ReviewModalProps {
    originalConfig: AppConfig;
    newConfig: AppConfig;
    onCancel: () => void;
    onConfirm: () => void;
}

// Simple LCS algorithm for line-diff
function diffLines(text1: string, text2: string) {
    const lines1 = text1.split('\n');
    const lines2 = text2.split('\n');
    const m = lines1.length;
    const n = lines2.length;

    // DP Table
    const dp = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (lines1[i - 1] === lines2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // Backtrack to build diff
    const diff = [];
    let i = m, j = n;

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && lines1[i - 1] === lines2[j - 1]) {
            diff.unshift({ type: 'same', content: lines1[i - 1], line: i }); // line numbers from old
            i--;
            j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            diff.unshift({ type: 'add', content: lines2[j - 1], line: null });
            j--;
        } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
            diff.unshift({ type: 'remove', content: lines1[i - 1], line: i });
            i--;
        }
    }

    return diff;
}

export default function ReviewModal({ originalConfig, newConfig, onCancel, onConfirm }: ReviewModalProps) {
    const diffs = useMemo(() => {
        const oldStr = JSON.stringify(originalConfig, null, 2);
        const newStr = JSON.stringify(newConfig, null, 2);
        return diffLines(oldStr, newStr);
    }, [originalConfig, newConfig]);

    // Calculate stats
    const additions = diffs.filter(d => d.type === 'add').length;
    const deletions = diffs.filter(d => d.type === 'remove').length;

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-8">
            <div className="bg-[#1a1a1a] border border-white/10 rounded-xl max-w-5xl w-full h-full max-h-[90vh] shadow-2xl flex flex-col">
                <div className="p-6 border-b border-white/10 flex justify-between items-center">
                    <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-3">
                            Review Changes
                            <span className="text-sm font-normal bg-white/10 px-2 py-0.5 rounded text-white/60">
                                {additions} additions, {deletions} deletions
                            </span>
                        </h2>
                    </div>
                    <button onClick={onCancel} className="text-white/60 hover:text-white">✕</button>
                </div>

                <div className="flex-grow overflow-auto p-0 bg-[#0d1117]">
                    <div className="font-mono text-xs md:text-sm">
                        {diffs.map((part, index) => {
                            let bgClass = '';
                            let textClass = 'text-gray-300';
                            let prefix = ' ';

                            if (part.type === 'add') {
                                bgClass = 'bg-green-900/30';
                                textClass = 'text-green-300';
                                prefix = '+';
                            } else if (part.type === 'remove') {
                                bgClass = 'bg-red-900/30';
                                textClass = 'text-red-300 line-through opacity-70';
                                prefix = '-';
                            } else {
                                // Provide context? or show all? 
                                // Showing all for now as config files aren't huge
                                textClass = 'text-gray-500';
                                prefix = ' ';
                            }

                            return (
                                <div key={index} className={`flex ${bgClass} hover:bg-white/5 transition-colors`}>
                                    <div className="w-10 flex-shrink-0 text-right pr-3 select-none text-white/20 border-r border-white/10 mr-3">
                                        {part.line || ' '}
                                    </div>
                                    <div className="w-6 flex-shrink-0 select-none text-white/40">
                                        {prefix}
                                    </div>
                                    <div className={`whitespace-pre-wrap break-all flex-grow ${textClass}`}>
                                        {part.content}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="p-6 border-t border-white/10 bg-[#1a1a1a] flex justify-end gap-3">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg transition-colors"
                    >
                        Keep Editing
                    </button>
                    <button
                        onClick={onConfirm}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors shadow-lg shadow-green-900/20 flex items-center gap-2"
                    >
                        <span>💾</span> Confirm & Save
                    </button>
                </div>
            </div>
        </div>
    );
}
