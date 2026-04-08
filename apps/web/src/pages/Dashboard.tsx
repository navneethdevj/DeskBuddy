// Default export allowed for page-level components
export default function Dashboard(): JSX.Element {
  return (
    <div className="min-h-screen bg-gray-50">
      <h1 className="text-2xl font-bold p-8">DeskBuddy</h1>
      {/* TODO: render KanbanBoard, WorkspaceNav */}
    </div>
  );
}
