"use client";

import { useParams } from "next/navigation";
import { ActivityPlayer } from "@/components/activity-player";

export default function ActivityPage() {
  const params = useParams<{ courseId: string; activityId: string }>();
  return <ActivityPlayer courseId={params.courseId} activityId={params.activityId} />;
}
