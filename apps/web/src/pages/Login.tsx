// Default export allowed for page-level components
export default function Login(): JSX.Element {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-6 text-center">Sign in to DeskBuddy</h1>
        {/* TODO: render Google OAuth button */}
        <button
          type="button"
          className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Continue with Google
        </button>
      </div>
    </div>
  );
}
