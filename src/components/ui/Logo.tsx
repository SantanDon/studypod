interface LogoProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const Logo = ({ size = "md", className = "" }: LogoProps) => {
  const sizes = { sm: "h-6 w-6", md: "h-8 w-8", lg: "h-12 w-12" };
  return (
    <img
      src={`${import.meta.env.BASE_URL}study-glyphs/studypod-mark.webp`}
      alt=""
      width={48}
      height={48}
      draggable={false}
      className={`${sizes[size]} shrink-0 object-contain dark:drop-shadow-[0_0_1px_white] ${className}`}
    />
  );
};
export default Logo;
