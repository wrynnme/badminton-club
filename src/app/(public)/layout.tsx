export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex flex-col min-w-0">
      {children}
    </main>
  );
}
