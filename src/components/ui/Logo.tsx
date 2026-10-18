import { AudioLines, BookOpen } from "lucide-react";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const Logo = ({ size = "md", className = "" }: LogoProps) => {
  const sizes = { sm: "h-6 w-6", md: "h-9 w-9", lg: "h-12 w-12" };
  return (
    <div aria-hidden="true" className={`${sizes[size]} relative flex shrink-0 items-center justify-center rounded-xl bg-teal-800 text-white ${className}`}>
      <BookOpen className="h-[55%] w-[55%]" strokeWidth={1.8} />
      <AudioLines className="absolute -bottom-1 -right-1 h-[45%] w-[45%] rounded bg-[#faf8f3] p-0.5 text-teal-800 dark:bg-background dark:text-teal-300" />
    </div>
  );
};
export default Logo;
