import { VisualNode } from '../types';

interface ConfigNodeProps {
    node: VisualNode;
    onClick: (node: VisualNode) => void;
}

export default function ConfigNode({ node, onClick }: ConfigNodeProps) {
    const getNodeColor = (type: string) => {
        switch (type) {
            case 'crawler': return 'border-blue-500 bg-blue-500/10 hover:bg-blue-500/20';
            case 'translator': return 'border-purple-500 bg-purple-500/10 hover:bg-purple-500/20';
            case 'forwarder': return 'border-orange-500 bg-orange-500/10 hover:bg-orange-500/20';
            case 'formatter': return 'border-pink-500 bg-pink-500/10 hover:bg-pink-500/20';
            case 'target': return 'border-green-500 bg-green-500/10 hover:bg-green-500/20';
            default: return 'border-gray-500';
        }
    };

    const getIcon = (type: string) => {
        switch (type) {
            case 'crawler': return '🕷️';
            case 'translator': return '🌐';
            case 'forwarder': return '⏩';
            case 'formatter': return '🎨';
            case 'target': return '🎯';
            default: return '📦';
        }
    };

    return (
        <div
            className={`absolute flex flex-col justify-center items-center p-4 rounded-xl border-2 cursor-pointer transition-all shadow-lg backdrop-blur-sm ${getNodeColor(node.type)}`}
            style={{
                left: node.x,
                top: node.y,
                width: node.width,
                height: node.height,
            }}
            onClick={() => onClick(node)}
        >
            <div className="text-2xl mb-2">{getIcon(node.type)}</div>
            <div className="text-white font-bold text-center text-sm w-full px-2 break-words whitespace-normal leading-tight" title={node.label}>
                {node.label}
            </div>
            <div className="text-white/40 text-xs mt-1 uppercase tracking-wider">
                {node.type}
            </div>

            {/* Status indicator if enabled/disabled */}
            {node.data?.enabled === false && (
                <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-red-500" title="Disabled" />
            )}

            {/* Schedule indicator for crawlers/forwarders */}
            {(node.type === 'crawler' || node.type === 'forwarder') && node.data?.cfg?.cron && (
                <div className="absolute bottom-2 right-2 text-[10px] text-white/50 font-mono">
                    ⏰
                </div>
            )}
        </div>
    );
}
