export default function GlowBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute top-[-20%] left-[-10%] h-[400px] w-[400px] rounded-full bg-primary/[0.08] blur-[120px] sm:h-[700px] sm:w-[700px] sm:blur-[180px]" />
      <div className="absolute bottom-[-20%] right-[-10%] h-[350px] w-[350px] rounded-full bg-accent/[0.08] blur-[100px] sm:h-[600px] sm:w-[600px] sm:blur-[160px]" />
      <div className="absolute top-[30%] left-1/2 h-[200px] w-[200px] -translate-x-1/2 rounded-full bg-primary/[0.05] blur-[80px] sm:h-[350px] sm:w-[350px] sm:blur-[120px]" />
    </div>
  );
}
