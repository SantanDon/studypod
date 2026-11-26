
import { Button } from '@/components/ui/button';

interface CitationButtonProps {
  chunkIndex: number;
  onClick: () => void;
  className?: string;
}

const CitationButton = ({ chunkIndex, onClick, className = '' }: CitationButtonProps) => {
  return (
    <Button
      variant="outline"
      size="sm"
      aria-label={`Citation ${chunkIndex + 1}, open source passage`}
      onClick={onClick}
      className={`inline-flex items-center justify-center w-6 h-6 [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:h-11 p-0 ml-1 text-xs font-medium text-blue-600 border-blue-300 hover:bg-blue-50 hover:border-blue-400 rounded-full ${className}`}
    >
      {chunkIndex + 1}
    </Button>
  );
};

export default CitationButton;
