<script setup lang="ts">
import {storeToRefs} from "pinia";
import {useIdeTheme} from "nbook/app/composables/useIdeTheme";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import {generateComplexPassword} from "nbook/app/utils/password";
import type {AdminUserListItemDto, AuthSessionDto} from "nbook/shared/dto/auth.dto";

definePageMeta({
    layout: false,
});

const users = ref<AdminUserListItemDto[]>([]);
const currentUser = ref<AuthSessionDto["user"]>(null);
const themeHostRef = ref<HTMLElement | null>(null);
const loading = ref(false);
const errorMessage = ref("");
const dialogErrorMessage = ref("");
const createOpen = ref(false);
const editTarget = ref<AdminUserListItemDto | null>(null);
const resetTarget = ref<AdminUserListItemDto | null>(null);

const createForm = reactive({
    username: "",
    displayName: "",
    password: "",
    role: "user" as "admin" | "user",
});
const editForm = reactive({
    displayName: "",
    role: "user" as "admin" | "user",
    status: "active" as "active" | "disabled",
});
const resetPassword = ref("");
const novelIdeStore = useNovelIdeStore();
const {theme} = storeToRefs(novelIdeStore);
const {mountThemeHost} = useIdeTheme(theme);
const editOpen = computed({
    get: () => Boolean(editTarget.value),
    set: (open: boolean): void => {
        if (!open) {
            editTarget.value = null;
        }
    },
});
const resetOpen = computed({
    get: () => Boolean(resetTarget.value),
    set: (open: boolean): void => {
        if (!open) {
            resetTarget.value = null;
            resetPassword.value = "";
        }
    },
});

/**
 * 自动生成新用户初始密码。
 */
const generateCreatePassword = (): void => {
    createForm.password = generateComplexPassword();
};

/**
 * 自动生成重置密码。
 */
const generateResetPassword = (): void => {
    resetPassword.value = generateComplexPassword();
};

/**
 * 加载用户列表。
 */
const loadUsers = async (): Promise<void> => {
    loading.value = true;
    errorMessage.value = "";
    try {
        const [session, list] = await Promise.all([
            $fetch<AuthSessionDto>("/api/auth/me"),
            $fetch<AdminUserListItemDto[]>("/api/admin/users"),
        ]);
        currentUser.value = session.user;
        users.value = list;
    } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : "加载用户失败";
    } finally {
        loading.value = false;
    }
};

/**
 * 创建新用户。
 */
const createUser = async (): Promise<void> => {
    dialogErrorMessage.value = "";
    try {
        await $fetch("/api/admin/users", {
            method: "POST",
            body: {
                username: createForm.username,
                displayName: createForm.displayName || undefined,
                password: createForm.password,
                role: createForm.role,
            },
        });
        createOpen.value = false;
        createForm.username = "";
        createForm.displayName = "";
        createForm.password = "";
        createForm.role = "user";
        await loadUsers();
    } catch (error) {
        dialogErrorMessage.value = error instanceof Error ? error.message : "创建失败";
    }
};

/**
 * 打开编辑窗口。
 */
const openEdit = (user: AdminUserListItemDto): void => {
    editTarget.value = user;
    editForm.displayName = user.displayName;
    editForm.role = user.role;
    editForm.status = user.status;
};

/**
 * 保存用户更新。
 */
const saveUser = async (): Promise<void> => {
    if (!editTarget.value) {
        return;
    }

    dialogErrorMessage.value = "";
    try {
        await $fetch(`/api/admin/users/${editTarget.value.id}`, {
            method: "PATCH",
            body: {
                displayName: editForm.displayName || undefined,
                role: editForm.role,
                status: editForm.status,
            },
        });
        editTarget.value = null;
        await loadUsers();
    } catch (error) {
        dialogErrorMessage.value = error instanceof Error ? error.message : "保存失败";
    }
};

/**
 * 提交密码重置。
 */
const submitReset = async (): Promise<void> => {
    if (!resetTarget.value) {
        return;
    }

    dialogErrorMessage.value = "";
    try {
        await $fetch(`/api/admin/users/${resetTarget.value.id}/password`, {
            method: "PUT",
            body: {
                password: resetPassword.value,
            },
        });
        resetTarget.value = null;
        resetPassword.value = "";
        await loadUsers();
    } catch (error) {
        dialogErrorMessage.value = error instanceof Error ? error.message : "重置失败";
    }
};

/**
 * 切换禁用/启用。
 */
const toggleStatus = async (user: AdminUserListItemDto): Promise<void> => {
    dialogErrorMessage.value = "";
    try {
        await $fetch(`/api/admin/users/${user.id}`, {
            method: "PATCH",
            body: {
                status: user.status === "active" ? "disabled" : "active",
            },
        });
        await loadUsers();
    } catch (error) {
        dialogErrorMessage.value = error instanceof Error ? error.message : "更新失败";
    }
};

/**
 * 退出登录并跳转登录页。
 */
const logout = async (): Promise<void> => {
    await $fetch("/api/auth/logout", {method: "POST"});
    await navigateTo("/login");
};

watch([createOpen, editOpen, resetOpen], () => {
    dialogErrorMessage.value = "";
});

onMounted(() => {
    mountThemeHost(themeHostRef.value);
    void loadUsers();
});
</script>

<template>
    <!-- 管理员用户后台 -->
    <div ref="themeHostRef" class="admin-page min-h-screen bg-[var(--bg-main)] text-[var(--text-main)] transition-colors duration-300">
        <div class="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-6 py-6">
            <header class="flex items-center justify-between gap-4 border-b border-[var(--border-color)] pb-4">
                <div>
                    <div class="text-2xl font-semibold">用户管理</div>
                    <div class="mt-1 text-sm text-[var(--text-secondary)]">用于创建、授权、禁用和重置全站用户。</div>
                </div>
                <div class="flex items-center gap-3">
                    <div class="text-right text-sm text-[var(--text-secondary)]">
                        <div>{{ currentUser?.displayName || currentUser?.username || "未登录" }}</div>
                        <div>{{ currentUser?.role || "" }}</div>
                    </div>
                    <button class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-sm hover:bg-[var(--bg-hover)]" @click="void logout()">
                        退出
                    </button>
                </div>
            </header>

            <div class="flex items-center justify-between">
                <div class="text-sm text-[var(--text-secondary)]">总用户数 {{ users.length }}</div>
                <button class="rounded-lg bg-[var(--accent-main)] px-4 py-2 text-sm font-medium text-white hover:opacity-90" @click="createOpen = true">
                    新建用户
                </button>
            </div>

            <div v-if="errorMessage" class="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {{ errorMessage }}
            </div>

            <div class="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)]">
                <table class="w-full border-collapse text-sm">
                    <thead class="bg-[var(--bg-input)] text-[var(--text-secondary)]">
                        <tr>
                            <th class="px-4 py-3 text-left font-medium">用户名</th>
                            <th class="px-4 py-3 text-left font-medium">显示名</th>
                            <th class="px-4 py-3 text-left font-medium">角色</th>
                            <th class="px-4 py-3 text-left font-medium">状态</th>
                            <th class="px-4 py-3 text-left font-medium">最后登录</th>
                            <th class="px-4 py-3 text-left font-medium">最后活跃</th>
                            <th class="px-4 py-3 text-left font-medium">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="user in users" :key="user.id" class="border-t border-[var(--border-color)] bg-[var(--bg-panel)]">
                            <td class="px-4 py-3">{{ user.username }}</td>
                            <td class="px-4 py-3">{{ user.displayName || "-" }}</td>
                            <td class="px-4 py-3">{{ user.role }}</td>
                            <td class="px-4 py-3">{{ user.status }}</td>
                            <td class="px-4 py-3">{{ user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "-" }}</td>
                            <td class="px-4 py-3">{{ user.lastSeenAt ? new Date(user.lastSeenAt).toLocaleString() : "-" }}</td>
                            <td class="px-4 py-3">
                                <div class="flex flex-wrap gap-2">
                                    <button class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)]" @click="openEdit(user)">编辑</button>
                                    <button class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)]" @click="resetTarget = user">重置密码</button>
                                    <button class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)]" @click="void toggleStatus(user)">
                                        {{ user.status === 'active' ? '禁用' : '启用' }}
                                    </button>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <Dialog v-model="createOpen" title="新建用户" width="520px" show-cancel :teleport-target="false" @confirm="void createUser()">
            <div class="space-y-4 text-sm">
                <div v-if="dialogErrorMessage" class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-200">
                    {{ dialogErrorMessage }}
                </div>
                <label class="block">
                    <div class="mb-2 text-[var(--text-secondary)]">用户名</div>
                    <FormInput v-model="createForm.username" placeholder="username" />
                </label>
                <label class="block">
                    <div class="mb-2 text-[var(--text-secondary)]">显示名</div>
                    <FormInput v-model="createForm.displayName" placeholder="可选" />
                </label>
                <label class="block">
                    <div class="mb-2 flex items-center justify-between gap-2">
                        <span class="text-[var(--text-secondary)]">密码</span>
                        <button type="button" class="inline-flex items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="generateCreatePassword">
                            <span class="i-lucide-wand-sparkles h-3.5 w-3.5"></span>
                            <span>自动生成</span>
                        </button>
                    </div>
                    <FormInput v-model="createForm.password" type="text" placeholder="至少 8 位" />
                </label>
                <label class="block">
                    <div class="mb-2 text-[var(--text-secondary)]">角色</div>
                    <FormSelect v-model="createForm.role" :options="[{label: 'user', value: 'user'}, {label: 'admin', value: 'admin'}]" />
                </label>
            </div>
        </Dialog>

        <Dialog v-model="editOpen" title="编辑用户" width="520px" show-cancel :teleport-target="false" @confirm="void saveUser()">
            <div class="space-y-4 text-sm">
                <div v-if="dialogErrorMessage" class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-200">
                    {{ dialogErrorMessage }}
                </div>
                <label class="block">
                    <div class="mb-2 text-[var(--text-secondary)]">显示名</div>
                    <FormInput v-model="editForm.displayName" placeholder="可选" />
                </label>
                <label class="block">
                    <div class="mb-2 text-[var(--text-secondary)]">角色</div>
                    <FormSelect v-model="editForm.role" :options="[{label: 'user', value: 'user'}, {label: 'admin', value: 'admin'}]" />
                </label>
                <label class="block">
                    <div class="mb-2 text-[var(--text-secondary)]">状态</div>
                    <FormSelect v-model="editForm.status" :options="[{label: 'active', value: 'active'}, {label: 'disabled', value: 'disabled'}]" />
                </label>
            </div>
        </Dialog>

        <Dialog v-model="resetOpen" title="重置密码" width="480px" show-cancel :teleport-target="false" @confirm="void submitReset()">
            <div class="space-y-4 text-sm">
                <div v-if="dialogErrorMessage" class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-200">
                    {{ dialogErrorMessage }}
                </div>
                <div class="text-[var(--text-secondary)]">为 <strong>{{ resetTarget?.username }}</strong> 设置新密码。</div>
                <label class="block">
                    <div class="mb-2 flex items-center justify-between gap-2">
                        <span class="text-[var(--text-secondary)]">新密码</span>
                        <button type="button" class="inline-flex items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="generateResetPassword">
                            <span class="i-lucide-wand-sparkles h-3.5 w-3.5"></span>
                            <span>自动生成</span>
                        </button>
                    </div>
                    <FormInput v-model="resetPassword" type="text" placeholder="至少 8 位" />
                </label>
            </div>
        </Dialog>
    </div>
</template>

<style scoped>
.admin-page {
    --editor-canvas-bg: var(--bg-main);
}
</style>
