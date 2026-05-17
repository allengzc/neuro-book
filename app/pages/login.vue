<script setup lang="ts">
import {storeToRefs} from "pinia";
import {useIdeTheme} from "nbook/app/composables/useIdeTheme";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import type {AuthSessionDto} from "nbook/shared/dto/auth.dto";

definePageMeta({
    layout: false,
});

const route = useRoute();
const router = useRouter();
const themeHostRef = ref<HTMLElement | null>(null);
const username = ref("");
const password = ref("");
const busy = ref(false);
const errorMessage = ref("");
const novelIdeStore = useNovelIdeStore();
const {theme} = storeToRefs(novelIdeStore);
const {mountThemeHost} = useIdeTheme(theme);

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

onMounted(() => {
    mountThemeHost(themeHostRef.value);
});
</script>

<template>
    <!-- 登录页外壳 -->
    <div ref="themeHostRef" class="auth-page min-h-screen bg-[var(--bg-main)] text-[var(--text-main)] transition-colors duration-300">
        <div class="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-10">
            <div class="w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-6 shadow-2xl">
                <div class="mb-6">
                    <div class="text-2xl font-semibold">登录</div>
                    <div class="mt-2 text-sm text-[var(--text-secondary)]">使用账号密码访问全站与管理员后台。</div>
                </div>

                <form class="space-y-4" @submit.prevent="submit">
                    <label class="block">
                        <div class="mb-2 text-sm text-[var(--text-secondary)]">用户名</div>
                        <FormInput v-model="username" autocomplete="username" placeholder="请输入用户名" />
                    </label>

                    <label class="block">
                        <div class="mb-2 text-sm text-[var(--text-secondary)]">密码</div>
                        <FormInput v-model="password" type="password" autocomplete="current-password" placeholder="请输入密码" />
                    </label>

                    <div v-if="errorMessage" class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
                        {{ errorMessage }}
                    </div>

                    <button
                        type="submit"
                        class="inline-flex h-10 w-full items-center justify-center rounded-lg bg-[var(--accent-main)] px-4 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                        :disabled="busy"
                    >
                        {{ busy ? "登录中..." : "登录" }}
                    </button>

                    <p class="pt-1 text-center text-xs text-[var(--text-secondary)]">
                        测试站点的密码联系
                        <a class="text-[var(--accent-text)] hover:underline" href="mailto:notnotype@qq.com">notnotype@qq.com</a>
                        获取
                    </p>
                </form>
            </div>
        </div>
    </div>
</template>
