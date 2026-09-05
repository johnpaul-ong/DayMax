"use client";

import { useParams } from "next/navigation";
import ProfileView from "../../profile-view";

export default function FriendProfilePage() {
  const params = useParams<{ userId: string }>();
  return <ProfileView userId={params.userId} />;
}
