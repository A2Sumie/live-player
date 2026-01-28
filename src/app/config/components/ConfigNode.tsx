import { VisualNode } from '../types';

interface ConfigNodeProps {
    node: VisualNode;
    onClick: (node: VisualNode) => void;
}

export default function ConfigNode({ node, onClick }: ConfigNodeProps) {
    const getNodeStyle = (type: string) => {
        const baseStyle = 'border-l-4 shadow-lg backdrop-blur-sm bg-gray-900/90 transition-all hover:-translate-y-1 hover:shadow-xl';
        switch (type) {
            case 'crawler': return `${baseStyle} border-blue-500 shadow-blue-900/20`;
            case 'translator': return `${baseStyle} border-purple-500 shadow-purple-900/20`;
            case 'forwarder': return `${baseStyle} border-orange-500 shadow-orange-900/20`;
            case 'formatter': return `${baseStyle} border-pink-500 shadow-pink-900/20`;
            case 'target': return `${baseStyle} border-green-500 shadow-green-900/20`;
            default: return `${baseStyle} border-gray-500`;
        }
    };

    return (
        <div
            className={`absolute flex flex-col justify-center items-start p-3 rounded-r-lg cursor-pointer ${getNodeStyle(node.type)}`}
            style={{
                left: node.x,
                top: node.y,
                width: node.width,
                height: node.height,
            }}
            onClick={() => onClick(node)}
        >
            <div className="text-white font-bold text-sm w-full break-words whitespace-normal leading-snug mb-1" title={node.label}>
                {node.label}
            </div>
            <div className="text-xs text-white/40 uppercase tracking-widest font-mono">
                {node.type}
            </div>

            {/* Status indicator if enabled/disabled */}
            {node.data?.enabled === false && (
                <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-red-500" title="Disabled" />
            )}

            {/* Schedule indicator for crawlers/forwarders */}
            {(node.type === 'crawler' || node.type === 'forwarder') && node.data?.cfg_crawler?.cron && (
                <div className="absolute bottom-2 right-2 text-[10px] text-white/50 font-mono bg-white/10 px-1 rounded">
                    {node.data?.cfg_crawler?.cron}
                </div>
            )}
            {(node.type === 'crawler' || node.type === 'forwarder') && node.data?.cfg_forwarder?.cron && (
                <div className="absolute bottom-2 right-2 text-[10px] text-white/50 font-mono bg-white/10 px-1 rounded">
                    {node.data?.cfg_forwarder?.cron}
                </div>
            )}
        </div>
    );
}
