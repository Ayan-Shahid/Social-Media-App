// Simple line icons, drawn for Glimpse.
type P = { className?: string; filled?: boolean };
const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, viewBox: "0 0 24 24", "aria-hidden": true };

export const HomeIcon = ({ className }: P) => <svg {...base} className={className}><path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" /></svg>;
export const SearchIcon = ({ className }: P) => <svg {...base} className={className}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>;
export const PlusIcon = ({ className }: P) => <svg {...base} className={className}><rect x="3.5" y="3.5" width="17" height="17" rx="4" /><path d="M12 8v8M8 12h8" /></svg>;
export const ChatIcon = ({ className }: P) => <svg {...base} className={className}><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z" /></svg>;
export const HeartIcon = ({ className, filled }: P) => <svg {...base} fill={filled ? "currentColor" : "none"} className={className}><path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10z" /></svg>;
export const CommentIcon = ({ className }: P) => <svg {...base} className={className}><path d="M20 11.5a7.5 7.5 0 0 1-10.8 6.7L4.5 19.5l1.3-4.2A7.5 7.5 0 1 1 20 11.5z" /></svg>;
export const LockIcon = ({ className }: P) => <svg {...base} className={className}><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></svg>;
export const SendIcon = ({ className }: P) => <svg {...base} className={className}><path d="M20.5 3.5 10 14M20.5 3.5 14 20.5l-4-6.5-6.5-4z" /></svg>;
export const TrashIcon = ({ className }: P) => <svg {...base} className={className}><path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" /></svg>;
export const BackIcon = ({ className }: P) => <svg {...base} className={className}><path d="M15 5 8 12l7 7" /></svg>;
export const ImageIcon = ({ className }: P) => <svg {...base} className={className}><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m20.5 16-5-5-8 8.5" /></svg>;
