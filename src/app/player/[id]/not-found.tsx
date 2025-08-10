import Link from 'next/link';

export default function PlayerNotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-400 mb-4">404</h1>
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">Player Not Found</h2>
        <p className="text-gray-600 mb-8">
          Sorry, the player you are looking for does not exist or has been taken offline.
        </p>
        <Link 
          href="/"
          className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 transition-colors"
        >
          Home
        </Link>
      </div>
    </div>
  );
}