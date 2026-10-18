import { BookOpen } from "lucide-react";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const Logo = ({ size = "md", className = "" }: LogoProps) => {
  const sizes = { sm: "h-6 w-6", md: "h-8 w-8", lg: "h-12 w-12" };
  return (
    <div aria-hidden="true" className={`${sizes[size]} relative flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-md ${className}`}>
      <BookOpen className="h-[55%] w-[55%]" strokeWidth={1.8} />
    </div>
  );
};
export default Logo;
