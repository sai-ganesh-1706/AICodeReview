import type { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import { prisma } from "@/lib/prisma";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      accessToken: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    accessToken?: string;
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "read:user repo",
        },
      },
    }),
  ],

  callbacks: {
    async signIn({ user, account }) {
      if (!account || account.provider !== "github") return false;

      const githubId = Number(account.providerAccountId);
      const accessToken = account.access_token ?? "";

      try {
        await prisma.user.upsert({
          where: { githubId },
          update: {
            login: user.name ?? "",
            avatarUrl: user.image ?? "",
            accessToken,
          },
          create: {
            githubId,
            login: user.name ?? "",
            avatarUrl: user.image ?? "",
            accessToken,
          },
        });
        return true;
      } catch (error) {
        console.error("Error upserting user on sign-in:", error);
        return false;
      }
    },

    async jwt({ token, account }) {
      if (account) {
        const githubId = Number(account.providerAccountId);
        const dbUser = await prisma.user.findUnique({
          where: { githubId },
        });
        if (dbUser) {
          token.userId = dbUser.id;
          token.accessToken = dbUser.accessToken;
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (token.userId) {
        session.user.id = token.userId;
      }
      if (token.accessToken) {
        session.user.accessToken = token.accessToken;
      }
      return session;
    },
  },

  pages: {
    signIn: "/login",
  },

  session: {
    strategy: "jwt",
  },

  secret: process.env.NEXTAUTH_SECRET,
};
