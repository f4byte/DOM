import { Link } from "react-router-dom";
import { Button, EmptyState } from "@/components/ui";

export function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      description="That page doesn't exist. Use the sidebar to get back on track."
      action={
        <Link to="/">
          <Button variant="outline">Back to dashboard</Button>
        </Link>
      }
    />
  );
}
