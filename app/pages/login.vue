<script setup lang="ts">
import type {AuthSessionDto} from "nbook/shared/dto/auth.dto";

definePageMeta({
    layout: false,
});

const route = useRoute();
const router = useRouter();
const username = ref("");
const password = ref("");
const busy = ref(false);
const errorMessage = ref("");

/**
 * 登录提交。
 */
const submit = async (): Promise<void> => {
    if (busy.value) {
        return;
    }

    busy.value = true;
    errorMessage.value = "";
    try {
        await $fetch<AuthSessionDto>("/api/auth/login", {
            method: "POST",
            body: {
                username: username.value,
                password: password.value,
            },
        });
        const redirect = typeof route.query.redirect === "string" && route.query.redirect.trim().startsWith("/") && !route.query.redirect.trim().startsWith("//")
            ? route.query.redirect
            : "/";
        await router.push(redirect);
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : "登录失败";
    } finally {
        busy.value = false;
    }
};
</script>

<template>
    <!-- 登录页外壳 -->
    <div class="auth-page min-h-screen bg-[#0f1115] text-white">
        <div class="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-10">
            <div class="w-full rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur">
                <div class="mb-6">
                    <div class="text-2xl font-semibold">登录</div>
                    <div class="mt-2 text-sm text-white/60">使用账号密码访问全站与管理员后台。</div>
                </div>

                <form class="space-y-4" @submit.prevent="submit">
                    <label class="block">
                        <div class="mb-2 text-sm text-white/70">用户名</div>
                        <FormInput v-model="username" autocomplete="username" placeholder="请输入用户名" />
                    </label>

                    <label class="block">
                        <div class="mb-2 text-sm text-white/70">密码</div>
                        <FormInput v-model="password" type="password" autocomplete="current-password" placeholder="请输入密码" />
                    </label>

                    <div v-if="errorMessage" class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                        {{ errorMessage }}
                    </div>

                    <button
                        type="submit"
                        class="inline-flex h-10 w-full items-center justify-center rounded-lg bg-white px-4 text-sm font-medium text-slate-900 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                        :disabled="busy"
                    >
                        {{ busy ? "登录中..." : "登录" }}
                    </button>
                </form>
            </div>
        </div>
    </div>
</template>

<style scoped>
.auth-page {
    --accent-main: #ffffff;
    --bg-input: rgb(15 23 42 / 0.84);
    --bg-hover: rgb(30 41 59 / 0.9);
    --border-color: rgb(255 255 255 / 0.14);
    --text-main: #ffffff;
    --text-muted: rgb(255 255 255 / 0.44);
}
</style>
