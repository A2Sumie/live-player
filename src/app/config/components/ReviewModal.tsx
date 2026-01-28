'use client';

import React from 'react';
import { AppConfig } from '../types';
import _ from 'lodash';

interface ReviewModalProps {
    originalConfig: AppConfig;
    newConfig: AppConfig;
    onCancel: () => void;
    onConfirm: () => void;
}

export default function ReviewModal({ originalConfig, newConfig, onCancel, onConfirm }: ReviewModalProps) {
    // Calculate simple diff
    const getDiff = () => {
        const diff: string[] = [];

        // Check formatters
        const origFormatters = originalConfig.formatters || [];
        const newFormatters = newConfig.formatters || [];
        if (newFormatters.length > origFormatters.length) {
            diff.push(`+ Added ${newFormatters.length - origFormatters.length} new formatter(s)`);
        }

        // Check targets
        const origTargets = originalConfig.forward_targets || [];
        const newTargets = newConfig.forward_targets || [];
        if (newTargets.length > origTargets.length) {
            diff.push(`+ Added ${newTargets.length - origTargets.length} new target(s)`);
        }

        // Check connections
        const origConns = originalConfig.connections || {};
        const newConns = newConfig.connections || {};

        let addedConnections = 0;
        let removedConnections = 0;

        // Simple JSON string comparison for deep diff (visual representation could be improved)
        if (!_.isEqual(origConns, newConns)) {
            diff.push('~ Connections modified');
        }

        // Generic check if nothing else caught
        if (diff.length === 0 && !_.isEqual(originalConfig, newConfig)) {
            diff.push('~ Configuration settings modified');
        }

        return diff;
    };

    const diffs = getDiff();

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
            <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-6 max-w-2xl w-full shadow-2xl">
                <h2 className="text-xl font-bold text-white mb-4">Review Changes</h2>

                <div className="bg-black/50 p-4 rounded-lg mb-6 max-h-[60vh] overflow-auto border border-white/5 font-mono text-sm">
                    {diffs.length > 0 ? (
                        <ul className="space-y-2">
                            {diffs.map((d, i) => (
                                <li key={i} className={d.startsWith('+') ? 'text-green-400' : d.startsWith('-') ? 'text-red-400' : 'text-blue-400'}>
                                    {d}
                                </li>
                            ))}
                            <li className="text-white/40 pt-2 text-xs border-t border-white/10 mt-2">
                                Full JSON Diff available in console debug
                            </li>
                        </ul>
                    ) : (
                        <p className="text-white/60">No visible changes detected, but objects may differ.</p>
                    )}

                    <details className="mt-4 text-xs text-white/40">
                        <summary className="cursor-pointer hover:text-white/60">View Raw Config State</summary>
                        <div className="grid grid-cols-2 gap-2 mt-2">
                            <div>
                                <h4 className="font-bold mb-1">Original</h4>
                                <pre className="overflow-auto max-h-40 bg-black/30 p-2 rounded">{JSON.stringify(originalConfig, null, 2)}</pre>
                            </div>
                            <div>
                                <h4 className="font-bold mb-1">New</h4>
                                <pre className="overflow-auto max-h-40 bg-black/30 p-2 rounded">{JSON.stringify(newConfig, null, 2)}</pre>
                            </div>
                        </div>
                    </details>
                </div>

                <div className="flex justify-end gap-3">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg transition-colors"
                    >
                        Keep Editing
                    </button>
                    <button
                        onClick={onConfirm}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors shadow-lg shadow-green-900/20"
                    >
                        Confirm & Save
                    </button>
                </div>
            </div>
        </div>
    );
}
