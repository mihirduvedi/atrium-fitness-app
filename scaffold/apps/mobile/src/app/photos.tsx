import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Path, Rect, Svg } from 'react-native-svg';
import { useApp } from '@/AppContext';
import { Button, Card, Eyebrow, ScreenScroll } from '@/components/ui';
import { persistProgressPhotoFile, removeProgressPhotoFile } from '@/photos/photoFiles';
import {
  deleteProgressPhoto,
  insertProgressPhoto,
  listProgressPhotos,
  normalizeProgressPhotoTags,
  PROGRESS_PHOTO_POSES,
  updateProgressPhoto,
  type ProgressPhoto,
  type ProgressPhotoPose,
} from '@/photos/progressPhotos';
import { borderWidth, radius, space, useTheme } from '@/theme';

const POSE_LABELS: Record<ProgressPhotoPose, string> = {
  front: 'Front',
  side: 'Side',
  back: 'Back',
  other: 'Other',
};

type PoseFilter = ProgressPhotoPose | 'all';
type TagFilter = string | 'all';
type SortMode = 'newest' | 'oldest' | 'weightHigh' | 'weightLow';

const SORT_LABELS: Record<SortMode, string> = {
  newest: 'Newest',
  oldest: 'Oldest',
  weightHigh: 'Weight high',
  weightLow: 'Weight low',
};

const CREATED_TAGS_KEY = 'atrium.progressPhoto.createdTags';

function dayLabel(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function dateSearchText(photo: ProgressPhoto) {
  const date = new Date(photo.taken_at);
  return [
    photo.taken_at.slice(0, 10),
    dayLabel(photo.taken_at),
    date.toLocaleDateString(),
    date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }),
  ].join(' ').toLowerCase();
}

function parseWeight(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function sameTagList(a: string[], b: string[]) {
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}

function InputBox({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad';
}) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 0, gap: 7 }}>
      <Text style={t.text('labelCaps', 'textMuted')}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.colors.textFaint}
        keyboardType={keyboardType}
        style={[
          t.text('bodyM'),
          {
            minHeight: 46,
            borderRadius: radius.control,
            borderWidth: borderWidth.hairline,
            borderColor: t.colors.borderHairline,
            backgroundColor: t.colors.bgSurface2,
            paddingHorizontal: 12,
          },
        ]}
      />
    </View>
  );
}

function DropdownChevron({ open }: { open?: boolean }) {
  const t = useTheme();
  return (
    <Svg
      width={14}
      height={14}
      viewBox="0 0 14 14"
      style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
    >
      <Path
        d="M3.5 5.25 7 8.75l3.5-3.5"
        fill="none"
        stroke={t.colors.textMuted}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function Checkmark({ selected }: { selected: boolean }) {
  const t = useTheme();
  if (!selected) return <View style={{ width: 16, height: 16 }} />;
  return (
    <Svg width={16} height={16} viewBox="0 0 16 16">
      <Path
        d="M3.25 8.15 6.25 11 12.75 4.75"
        fill="none"
        stroke={t.colors.textPrimary}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function TrashIcon() {
  const t = useTheme();
  return (
    <Svg width={15} height={15} viewBox="0 0 16 16">
      <Path
        d="M5.25 4.25V3.2c0-.75.5-1.2 1.25-1.2h3c.75 0 1.25.45 1.25 1.2v1.05"
        fill="none"
        stroke={t.colors.textMuted}
        strokeWidth={1.45}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M3.15 4.25h9.7M4.35 6.1l.45 6.45c.05.82.55 1.25 1.38 1.25h3.64c.83 0 1.33-.43 1.38-1.25l.45-6.45M6.75 7.25v4.1M9.25 7.25v4.1"
        fill="none"
        stroke={t.colors.textMuted}
        strokeWidth={1.45}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function PrivacyPromise() {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        borderRadius: radius.card,
        borderWidth: borderWidth.hairline,
        borderColor: t.colors.borderHairline,
        backgroundColor: t.colors.bgSurface2,
        paddingHorizontal: 14,
        paddingVertical: 13,
      }}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 19,
          backgroundColor: t.colors.bgSurface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Svg width={19} height={19} viewBox="0 0 24 24">
          <Rect x="5.5" y="10.2" width="13" height="9" rx="2.4" fill="none" stroke={t.colors.textMuted} strokeWidth={1.9} />
          <Path d="M8.3 10.2V8a3.7 3.7 0 0 1 7.4 0v2.2" fill="none" stroke={t.colors.textMuted} strokeWidth={1.9} strokeLinecap="round" />
        </Svg>
      </View>
      <Text style={[t.text('bodyS', 'textMuted'), { flex: 1, minWidth: 0 }]}>
        <Text style={t.text('bodyS')}>Private by default. </Text>
        Photos stay on this device until cloud backup exists.
      </Text>
    </View>
  );
}

function BackChevron() {
  const t = useTheme();
  return (
    <Svg width={19} height={19} viewBox="0 0 20 20">
      <Path
        d="M12.25 4.75 7 10l5.25 5.25"
        fill="none"
        stroke={t.colors.textMuted}
        strokeWidth={2.15}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ProgressBackButton() {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back to Progress"
      hitSlop={8}
      onPress={() => router.replace('/(tabs)/progress')}
      style={({ pressed }) => ({
        minHeight: 34,
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 2,
        marginLeft: -5,
        opacity: pressed ? 0.58 : 1,
      })}
    >
      <BackChevron />
      <Text style={[t.text('bodyM', 'textMuted'), { fontSize: 14.5, fontWeight: '500' }]}>
        Progress
      </Text>
    </Pressable>
  );
}

function MenuOption({
  label,
  detail,
  selected,
  onPress,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 42,
        borderRadius: 13,
        backgroundColor: selected
          ? (t.mode === 'night' ? 'rgba(235, 232, 224, 0.12)' : 'rgba(26, 25, 24, 0.08)')
          : 'transparent',
        paddingHorizontal: 11,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space[3],
        opacity: pressed ? 0.68 : 1,
      })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={t.text('bodyM')}>
          {label}
        </Text>
        {detail && (
          <Text numberOfLines={1} style={t.text('bodyS', 'textMuted')}>
            {detail}
          </Text>
        )}
      </View>
      <Checkmark selected={selected} />
    </Pressable>
  );
}

function TagMenuOption({
  tag,
  selected,
  onToggle,
  onDelete,
}: {
  tag: string;
  selected: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        minHeight: 42,
        borderRadius: 13,
        backgroundColor: selected
          ? (t.mode === 'night' ? 'rgba(235, 232, 224, 0.12)' : 'rgba(26, 25, 24, 0.08)')
          : 'transparent',
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={onToggle}
        style={({ pressed }) => ({
          flex: 1,
          minHeight: 42,
          paddingLeft: 11,
          paddingRight: 8,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space[3],
          opacity: pressed ? 0.68 : 1,
        })}
      >
        <Text numberOfLines={1} style={[t.text('bodyM'), { flex: 1, minWidth: 0 }]}>
          #{tag}
        </Text>
        <Checkmark selected={selected} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Delete #${tag} tag`}
        onPress={onDelete}
        hitSlop={6}
        style={({ pressed }) => ({
          width: 42,
          height: 42,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.62 : 1,
        })}
      >
        <TrashIcon />
      </Pressable>
    </View>
  );
}

function DropdownButton({
  label,
  value,
  onPress,
  open,
  children,
  align = 'left',
  menuWidth,
  maxMenuHeight,
}: {
  label: string;
  value: string;
  onPress: () => void;
  open?: boolean;
  children?: ReactNode;
  align?: 'left' | 'right';
  menuWidth?: number | `${number}%`;
  maxMenuHeight?: number;
}) {
  const t = useTheme();
  const fullWidth = menuWidth === '100%';
  return (
    <View
      style={{
        flex: fullWidth ? undefined : 1,
        width: fullWidth ? '100%' : undefined,
        minWidth: 0,
        position: 'relative',
        zIndex: open ? 80 : 1,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: !!open }}
        onPress={onPress}
        style={({ pressed }) => ({
          minHeight: 54,
          borderRadius: 20,
          borderWidth: borderWidth.hairline,
          borderColor: open ? t.colors.borderStrong : t.colors.borderHairline,
          backgroundColor: t.mode === 'night' ? 'rgba(42, 41, 39, 0.78)' : 'rgba(246, 245, 242, 0.82)',
          paddingHorizontal: 13,
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOpacity: open ? 0.08 : 0,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 8 },
          opacity: pressed ? 0.72 : 1,
        })}
      >
        <Text style={[t.text('labelCaps', 'textMuted'), { marginBottom: 3 }]}>{label}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] }}>
          <Text numberOfLines={1} style={[t.text('bodyM'), { flex: 1, minWidth: 0 }]}>
            {value}
          </Text>
          <DropdownChevron open={open} />
        </View>
      </Pressable>
      {open && children && (
        <View
          style={{
            position: 'absolute',
            top: 60,
            ...(align === 'right' ? { right: 0 } : { left: 0 }),
            width: menuWidth ?? '100%',
            borderRadius: 22,
            overflow: 'hidden',
            borderWidth: borderWidth.hairline,
            borderColor: t.mode === 'night' ? 'rgba(235, 232, 224, 0.14)' : 'rgba(255, 255, 255, 0.88)',
            shadowColor: '#000',
            shadowOpacity: 0.16,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 16 },
            zIndex: 100,
          }}
        >
          <BlurView
            intensity={t.mode === 'night' ? 56 : 82}
            tint={t.mode === 'night' ? 'dark' : 'light'}
            style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
          />
          <View
            style={{
              backgroundColor: t.mode === 'night' ? 'rgba(34, 33, 31, 0.78)' : 'rgba(255, 255, 255, 0.76)',
              padding: 8,
              gap: 3,
            }}
          >
            {maxMenuHeight ? (
              <ScrollView
                style={{ maxHeight: maxMenuHeight }}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                bounces
              >
                <View style={{ gap: 3 }}>{children}</View>
              </ScrollView>
            ) : children}
          </View>
        </View>
      )}
    </View>
  );
}

function CreateTagRow({
  value,
  onChangeText,
  onCreate,
}: {
  value: string;
  onChangeText: (value: string) => void;
  onCreate: () => void;
}) {
  const t = useTheme();
  const canCreate = value.trim().length > 0;
  return (
    <View
      style={{
        minHeight: 44,
        borderRadius: 14,
        backgroundColor: t.colors.bgSurface2,
        paddingLeft: 11,
        paddingRight: 6,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2],
      }}
    >
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="Create new tag"
        placeholderTextColor={t.colors.textFaint}
        autoCapitalize="none"
        style={[
          t.text('bodyM'),
          {
            flex: 1,
            minWidth: 0,
            height: 42,
            lineHeight: 18,
            paddingTop: 0,
            paddingBottom: 0,
            paddingHorizontal: 0,
            textAlignVertical: 'center',
          },
        ]}
      />
      <Pressable
        accessibilityRole="button"
        disabled={!canCreate}
        onPress={onCreate}
        style={({ pressed }) => ({
          minWidth: 48,
          height: 32,
          borderRadius: 16,
          backgroundColor: t.colors.actionInk,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: !canCreate ? 0.34 : pressed ? 0.7 : 1,
        })}
      >
        <Text style={t.text('bodyS', 'actionOnInk')}>Add</Text>
      </Pressable>
    </View>
  );
}

function TagPill({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole={onRemove ? 'button' : undefined}
      disabled={!onRemove}
      onPress={onRemove}
      style={({ pressed }) => ({
        minHeight: 28,
        borderRadius: 14,
        backgroundColor: t.colors.bgSurface2,
        paddingHorizontal: 10,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.72 : 1,
      })}
    >
      <Text style={t.text('labelCaps', 'textMuted')}>#{tag}{onRemove ? ' x' : ''}</Text>
    </Pressable>
  );
}

function TagDropdown({
  selectedTags,
  availableTags,
  open,
  onPress,
  onRemoveTag,
  onToggleTag,
  onDeleteTag,
  newTagDraft,
  onNewTagDraftChange,
  onCreateTag,
}: {
  selectedTags: string[];
  availableTags: string[];
  open: boolean;
  onPress: () => void;
  onRemoveTag: (tag: string) => void;
  onToggleTag: (tag: string) => void;
  onDeleteTag: (tag: string) => void;
  newTagDraft: string;
  onNewTagDraftChange: (value: string) => void;
  onCreateTag: () => void;
}) {
  const t = useTheme();
  const label = selectedTags.length === 0
    ? 'Choose tags'
    : selectedTags.length === 1
      ? `#${selectedTags[0]}`
      : `${selectedTags.length} selected`;
  return (
    <View style={{ gap: space[2] }}>
      <DropdownButton label="Tags" value={label} open={open} onPress={onPress} menuWidth="100%" maxMenuHeight={230}>
        <CreateTagRow value={newTagDraft} onChangeText={onNewTagDraftChange} onCreate={onCreateTag} />
        <View style={{ height: borderWidth.hairline, backgroundColor: t.colors.borderHairline, marginVertical: 4 }} />
        {availableTags.length === 0 ? (
          <Text style={[t.text('bodyS', 'textMuted'), { paddingHorizontal: 11, paddingVertical: 8 }]}>
            Saved tags will appear here.
          </Text>
        ) : (
          availableTags.map((tag) => (
            <TagMenuOption
              key={tag}
              tag={tag}
              selected={selectedTags.includes(tag)}
              onToggle={() => onToggleTag(tag)}
              onDelete={() => onDeleteTag(tag)}
            />
          ))
        )}
      </DropdownButton>
      {selectedTags.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          {selectedTags.map((tag) => <TagPill key={tag} tag={tag} onRemove={() => onRemoveTag(tag)} />)}
        </View>
      )}
    </View>
  );
}

function PoseSelector({
  value,
  onChange,
}: {
  value: ProgressPhotoPose;
  onChange: (value: ProgressPhotoPose) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: space[2] }}>
      {PROGRESS_PHOTO_POSES.map((pose) => {
        const active = pose === value;
        return (
          <Pressable
            key={pose}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(pose)}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 36,
              borderRadius: radius.control,
              borderWidth: borderWidth.hairline,
              borderColor: active ? t.colors.borderStrong : t.colors.borderHairline,
              backgroundColor: active ? t.colors.actionInk : t.colors.bgSurface2,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.72 : 1,
            })}
          >
            <Text numberOfLines={1} adjustsFontSizeToFit style={t.text('labelCaps', active ? 'actionOnInk' : 'textMuted')}>
              {POSE_LABELS[pose]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function PhotoTile({
  photo,
  onEdit,
  onDelete,
  onPreview,
}: {
  photo: ProgressPhoto;
  onEdit: (photo: ProgressPhoto) => void;
  onDelete: (photo: ProgressPhoto) => void;
  onPreview: (photo: ProgressPhoto) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ width: '48.2%', minWidth: 0 }}>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <Pressable
          accessibilityRole="imagebutton"
          onPress={() => onPreview(photo)}
          style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
        >
          <Image
            source={{ uri: photo.image_uri }}
            resizeMode="cover"
            style={{
              width: '100%',
              aspectRatio: 0.78,
              backgroundColor: t.colors.bgSurface2,
            }}
          />
          <View
            style={{
              position: 'absolute',
              left: 8,
              top: 8,
              borderRadius: radius.control,
              backgroundColor: t.mode === 'night' ? 'rgba(26, 25, 24, 0.74)' : 'rgba(255, 255, 255, 0.82)',
              paddingHorizontal: 8,
              paddingVertical: 4,
            }}
          >
            <Text style={[t.text('labelCaps', 'textMuted'), { fontSize: 8.5 }]}>{POSE_LABELS[photo.pose]}</Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => onEdit(photo)}
          style={({ pressed }) => ({ padding: 10, gap: 3, opacity: pressed ? 0.62 : 1 })}
        >
          <Text numberOfLines={1} style={t.text('displayS')}>
            {dayLabel(photo.taken_at)}
          </Text>
          <Text numberOfLines={1} style={t.text('bodyS', 'textMuted')}>
            {photo.body_weight ? `${photo.body_weight} lb` : 'No weight logged'}
          </Text>
          {photo.note && (
            <Text numberOfLines={3} style={[t.text('bodyS', 'textMuted'), { marginTop: 3 }]}>
              {photo.note}
            </Text>
          )}
          {photo.tags.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
              {photo.tags.slice(0, 2).map((tag) => (
                <View
                  key={tag}
                  style={{
                    minHeight: 22,
                    borderRadius: radius.control,
                    backgroundColor: t.colors.bgSurface2,
                    paddingHorizontal: 7,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={[t.text('labelCaps', 'textMuted'), { fontSize: 8.5 }]}>#{tag}</Text>
                </View>
              ))}
              {photo.tags.length > 2 && (
                <Text style={[t.text('labelCaps', 'textMuted'), { fontSize: 8.5, paddingTop: 5 }]}>
                  +{photo.tags.length - 2}
                </Text>
              )}
            </View>
          )}
        </Pressable>
        <View
          style={{
            flexDirection: 'row',
            borderTopWidth: borderWidth.hairline,
            borderTopColor: t.colors.borderHairline,
          }}
        >
          <Pressable
            accessibilityRole="button"
            onPress={() => onEdit(photo)}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 36,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.62 : 1,
            })}
          >
            <Text style={t.text('labelCaps', 'textMuted')}>Edit</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => onDelete(photo)}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 36,
              borderLeftWidth: borderWidth.hairline,
              borderLeftColor: t.colors.borderHairline,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.62 : 1,
            })}
          >
            <Text style={t.text('labelCaps', 'textMuted')}>Remove</Text>
          </Pressable>
        </View>
      </Card>
    </View>
  );
}

function PhotoPreviewModal({
  photo,
  onClose,
}: {
  photo: ProgressPhoto | null;
  onClose: () => void;
}) {
  const t = useTheme();
  return (
    <Modal visible={!!photo} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.88)', padding: 20, justifyContent: 'center' }}>
        {photo && (
          <>
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => ({
                position: 'absolute',
                top: 56,
                right: 22,
                zIndex: 1,
                minWidth: 68,
                minHeight: 38,
                borderRadius: radius.control,
                backgroundColor: 'rgba(255, 255, 255, 0.16)',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.72 : 1,
              })}
            >
              <Text style={t.text('button', 'actionOnInk')}>Close</Text>
            </Pressable>
            <Image
              source={{ uri: photo.image_uri }}
              resizeMode="contain"
              style={{ width: '100%', height: '72%', borderRadius: radius.card }}
            />
            <View style={{ marginTop: space[4], gap: 4 }}>
              <Text style={[t.text('labelCaps', 'actionOnInk'), { opacity: 0.72 }]}>{POSE_LABELS[photo.pose]}</Text>
              <Text style={t.text('displayS', 'actionOnInk')}>{dayLabel(photo.taken_at)}</Text>
              <Text style={[t.text('bodyS', 'actionOnInk'), { opacity: 0.72 }]}>
              {photo.body_weight ? `${photo.body_weight} lb` : 'No weight logged'}
              </Text>
              {photo.note && <Text style={[t.text('bodyS', 'actionOnInk'), { opacity: 0.72 }]}>{photo.note}</Text>}
              {photo.tags.length > 0 && (
                <Text style={[t.text('bodyS', 'actionOnInk'), { opacity: 0.72 }]}>
                  {photo.tags.map((tag) => `#${tag}`).join('  ')}
                </Text>
              )}
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

function EditPhotoModal({
  photo,
  pose,
  bodyWeight,
  note,
  selectedTags,
  availableTags,
  tagMenuOpen,
  newTagDraft,
  busy,
  onPoseChange,
  onBodyWeightChange,
  onNoteChange,
  onToggleTagMenu,
  onRemoveTag,
  onCreateTag,
  onToggleTag,
  onDeleteTag,
  onNewTagDraftChange,
  onCancel,
  onSave,
}: {
  photo: ProgressPhoto | null;
  pose: ProgressPhotoPose;
  bodyWeight: string;
  note: string;
  selectedTags: string[];
  availableTags: string[];
  tagMenuOpen: boolean;
  newTagDraft: string;
  busy: boolean;
  onPoseChange: (pose: ProgressPhotoPose) => void;
  onBodyWeightChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onToggleTagMenu: () => void;
  onRemoveTag: (tag: string) => void;
  onCreateTag: () => void;
  onToggleTag: (tag: string) => void;
  onDeleteTag: (tag: string) => void;
  onNewTagDraftChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const t = useTheme();
  return (
    <Modal visible={!!photo} transparent animationType="fade" onRequestClose={onCancel}>
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(26, 25, 24, 0.34)',
          justifyContent: 'center',
          padding: 20,
        }}
      >
        <Card style={{ gap: space[4], shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 18, shadowOffset: { width: 0, height: 10 } }}>
          <View>
            <Eyebrow>Edit photo</Eyebrow>
            <Text style={t.text('displayS')}>{photo ? dayLabel(photo.taken_at) : 'Photo'}</Text>
          </View>
          <PoseSelector value={pose} onChange={onPoseChange} />
          <View style={{ flexDirection: 'row', gap: space[3] }}>
            <InputBox
              label="Body weight"
              value={bodyWeight}
              onChangeText={onBodyWeightChange}
              placeholder="Optional"
              keyboardType="decimal-pad"
            />
            <InputBox label="Note" value={note} onChangeText={onNoteChange} placeholder="Optional" />
          </View>
          <View style={{ zIndex: 40 }}>
            <TagDropdown
              selectedTags={selectedTags}
              availableTags={availableTags}
              open={tagMenuOpen}
              onPress={onToggleTagMenu}
              onRemoveTag={onRemoveTag}
              onToggleTag={onToggleTag}
              onDeleteTag={onDeleteTag}
              newTagDraft={newTagDraft}
              onNewTagDraftChange={onNewTagDraftChange}
              onCreateTag={onCreateTag}
            />
          </View>
          <View style={{ flexDirection: 'row', gap: space[3], paddingTop: space[1] }}>
            <Button title={busy ? 'Saving' : 'Save changes'} disabled={busy} onPress={onSave} style={{ flex: 1 }} />
            <Button title="Cancel" ghost disabled={busy} onPress={onCancel} style={{ flex: 1 }} />
          </View>
        </Card>
      </View>
    </Modal>
  );
}

export default function ProgressPhotosScreen() {
  const t = useTheme();
  const { db, userId, newId } = useApp();
  const [photos, setPhotos] = useState<ProgressPhoto[]>([]);
  const [pose, setPose] = useState<ProgressPhotoPose>('front');
  const [bodyWeight, setBodyWeight] = useState('');
  const [note, setNote] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [pendingUri, setPendingUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<ProgressPhoto | null>(null);
  const [editingPhoto, setEditingPhoto] = useState<ProgressPhoto | null>(null);
  const [editPose, setEditPose] = useState<ProgressPhotoPose>('front');
  const [editBodyWeight, setEditBodyWeight] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editSelectedTags, setEditSelectedTags] = useState<string[]>([]);
  const [createdTags, setCreatedTags] = useState<string[]>([]);
  const [editBusy, setEditBusy] = useState(false);
  const [dateQuery, setDateQuery] = useState('');
  const [poseFilter, setPoseFilter] = useState<PoseFilter>('all');
  const [tagFilter, setTagFilter] = useState<TagFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [openMenu, setOpenMenu] = useState<'sort' | 'filter' | null>(null);
  const [tagMenuTarget, setTagMenuTarget] = useState<'new' | 'edit' | null>(null);
  const [newTagDraft, setNewTagDraft] = useState('');

  const refresh = useCallback(async () => {
    setPhotos(await listProgressPhotos(db, userId));
  }, [db, userId]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(CREATED_TAGS_KEY).then((value) => {
      if (!live || !value) return;
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          const storedTags = normalizeProgressPhotoTags(parsed);
          setCreatedTags((current) => {
            const next = normalizeProgressPhotoTags([...current, ...storedTags]);
            if (sameTagList(current, next)) return current;
            AsyncStorage.setItem(CREATED_TAGS_KEY, JSON.stringify(next)).catch(() => {});
            return next;
          });
        }
      } catch {
        // Ignore stale local data; tags from saved photos still load from SQLite.
      }
    }).catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const rememberTags = useCallback((tags: string[]) => {
    const normalizedTags = normalizeProgressPhotoTags(tags);
    if (normalizedTags.length === 0) return;
    setCreatedTags((current) => {
      const next = normalizeProgressPhotoTags([...current, ...normalizedTags]);
      if (sameTagList(current, next)) return current;
      AsyncStorage.setItem(CREATED_TAGS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const forgetTag = useCallback((tag: string) => {
    setCreatedTags((current) => {
      const next = current.filter((item) => item !== tag);
      if (sameTagList(current, next)) return current;
      AsyncStorage.setItem(CREATED_TAGS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  useEffect(() => {
    rememberTags([
      ...photos.flatMap((photo) => photo.tags),
      ...selectedTags,
      ...editSelectedTags,
    ]);
  }, [editSelectedTags, photos, rememberTags, selectedTags]);

  const latestPhoto = photos[0] ?? null;
  const availableTags = useMemo(
    () => Array.from(new Set([
      ...photos.flatMap((photo) => photo.tags),
      ...createdTags,
      ...selectedTags,
      ...editSelectedTags,
    ])).sort((a, b) => a.localeCompare(b)),
    [createdTags, editSelectedTags, photos, selectedTags],
  );
  const visiblePhotos = useMemo(() => {
    const query = dateQuery.trim().toLowerCase();
    const filtered = photos.filter((photo) => {
      if (poseFilter !== 'all' && photo.pose !== poseFilter) return false;
      if (tagFilter !== 'all' && !photo.tags.includes(tagFilter)) return false;
      if (query && !dateSearchText(photo).includes(query)) return false;
      return true;
    });
    return filtered.slice().sort((a, b) => {
      if (sortMode === 'oldest') return Date.parse(a.taken_at) - Date.parse(b.taken_at);
      if (sortMode === 'weightHigh') return (b.body_weight ?? -Infinity) - (a.body_weight ?? -Infinity);
      if (sortMode === 'weightLow') return (a.body_weight ?? Infinity) - (b.body_weight ?? Infinity);
      return Date.parse(b.taken_at) - Date.parse(a.taken_at);
    });
  }, [dateQuery, photos, poseFilter, sortMode, tagFilter]);
  const activeFilterCount = (poseFilter === 'all' ? 0 : 1) + (tagFilter === 'all' ? 0 : 1);
  const filterLabel = activeFilterCount === 0 ? 'All photos' : `${activeFilterCount} active`;

  const detailLine = useMemo(() => {
    if (photos.length === 0) return 'No photos saved';
    if (!latestPhoto) return `${photos.length} saved`;
    return `${photos.length} saved - latest ${dayLabel(latestPhoto.taken_at)}`;
  }, [latestPhoto, photos.length]);

  const handleSavePhoto = useCallback(async () => {
    if (!pendingUri || busy) return;
    const weight = parseWeight(bodyWeight);
    if (weight === undefined) {
      Alert.alert('Progress photos', 'Enter a valid body weight or leave it blank.');
      return;
    }
    setBusy(true);
    try {
      const id = newId();
      const imageUri = await persistProgressPhotoFile(pendingUri, id);
      await insertProgressPhoto(db, {
        id,
        userId,
        imageUri,
        pose,
        bodyWeight: weight,
        note,
        tags: selectedTags,
      });
      setPendingUri(null);
      setBodyWeight('');
      setNote('');
      setSelectedTags([]);
      setPose('front');
      await refresh();
      Alert.alert('Progress photos', 'Photo saved to your log.');
    } catch (error) {
      Alert.alert('Progress photos', error instanceof Error ? error.message : 'Could not save the photo.');
    } finally {
      setBusy(false);
    }
  }, [bodyWeight, busy, db, newId, note, pendingUri, pose, refresh, selectedTags, userId]);

  const handlePickPhoto = useCallback(async (source: 'camera' | 'library') => {
    if (busy) return;
    setBusy(true);
    try {
      const permission = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync(false);
      if (!permission.granted) {
        Alert.alert('Progress photos', source === 'camera' ? 'Camera access is needed.' : 'Photo library access is needed.');
        return;
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9, allowsEditing: false })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9, allowsEditing: false, selectionLimit: 1 });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      setPendingUri(result.assets[0].uri);
    } catch (error) {
      Alert.alert('Progress photos', error instanceof Error ? error.message : 'Could not open photos.');
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const clearPendingPhoto = useCallback(() => {
    setPendingUri(null);
    setBodyWeight('');
    setNote('');
    setSelectedTags([]);
    setPose('front');
    setTagMenuTarget(null);
  }, []);

  const handleDelete = useCallback((photo: ProgressPhoto) => {
    Alert.alert('Remove photo', 'This removes it from Atrium on this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await deleteProgressPhoto(db, userId, photo.id);
          await removeProgressPhotoFile(photo.image_uri).catch(() => {});
          await refresh();
        },
      },
    ]);
  }, [db, refresh, userId]);

  const openEditPhoto = useCallback((photo: ProgressPhoto) => {
    setEditingPhoto(photo);
    setEditPose(photo.pose);
    setEditBodyWeight(photo.body_weight ? String(photo.body_weight) : '');
    setEditNote(photo.note ?? '');
    setEditSelectedTags(photo.tags);
  }, []);

  const closeEditPhoto = useCallback(() => {
    if (editBusy) return;
    setEditingPhoto(null);
    setTagMenuTarget(null);
  }, [editBusy]);

  const handleUpdatePhoto = useCallback(async () => {
    if (!editingPhoto || editBusy) return;
    const weight = parseWeight(editBodyWeight);
    if (weight === undefined) {
      Alert.alert('Progress photos', 'Enter a valid body weight or leave it blank.');
      return;
    }
    setEditBusy(true);
    try {
      await updateProgressPhoto(db, {
        id: editingPhoto.id,
        userId,
        pose: editPose,
        bodyWeight: weight,
        note: editNote,
        tags: editSelectedTags,
      });
      setEditingPhoto(null);
      await refresh();
      Alert.alert('Progress photos', 'Photo updated.');
    } catch (error) {
      Alert.alert('Progress photos', error instanceof Error ? error.message : 'Could not update the photo.');
    } finally {
      setEditBusy(false);
    }
  }, [db, editBodyWeight, editBusy, editNote, editPose, editSelectedTags, editingPhoto, refresh, userId]);

  const removeDraftTag = useCallback((tag: string) => {
    setSelectedTags((current) => current.filter((item) => item !== tag));
  }, []);

  const removeEditTag = useCallback((tag: string) => {
    setEditSelectedTags((current) => current.filter((item) => item !== tag));
  }, []);

  const toggleTagForTarget = useCallback((target: 'new' | 'edit', tag: string) => {
    rememberTags([tag]);
    const update = (current: string[]) =>
      current.includes(tag)
        ? current.filter((item) => item !== tag)
        : normalizeProgressPhotoTags([...current, tag]);
    if (target === 'new') setSelectedTags(update);
    else setEditSelectedTags(update);
  }, [rememberTags]);

  const createTagForTarget = useCallback((target: 'new' | 'edit') => {
    const [tag] = normalizeProgressPhotoTags([newTagDraft]);
    if (!tag) {
      Alert.alert('Tags', 'Enter a tag name.');
      return;
    }
    if (target === 'new') {
      setSelectedTags((current) => normalizeProgressPhotoTags([...current, tag]));
    } else {
      setEditSelectedTags((current) => normalizeProgressPhotoTags([...current, tag]));
    }
    rememberTags([tag]);
    setNewTagDraft('');
  }, [newTagDraft, rememberTags]);

  const deleteTagEverywhere = useCallback(async (tag: string) => {
    const photosWithTag = photos.filter((photo) => photo.tags.includes(tag));
    forgetTag(tag);
    setPhotos((current) => current.map((photo) => (
      photo.tags.includes(tag) ? { ...photo, tags: photo.tags.filter((item) => item !== tag) } : photo
    )));
    setSelectedTags((current) => current.filter((item) => item !== tag));
    setEditSelectedTags((current) => current.filter((item) => item !== tag));
    setTagFilter((current) => current === tag ? 'all' : current);

    await Promise.all(photosWithTag.map((photo) =>
      updateProgressPhoto(db, {
        id: photo.id,
        userId,
        pose: photo.pose,
        bodyWeight: photo.body_weight,
        note: photo.note,
        tags: photo.tags.filter((item) => item !== tag),
      }),
    ));
    await refresh();
  }, [db, forgetTag, photos, refresh, userId]);

  const confirmDeleteTag = useCallback((tag: string) => {
    Alert.alert(
      'Delete tag',
      `Delete #${tag} permanently? This removes it from all progress photos.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteTagEverywhere(tag).catch((error) => {
              Alert.alert('Tags', error instanceof Error ? error.message : 'Could not delete the tag.');
            });
          },
        },
      ],
    );
  }, [deleteTagEverywhere]);

  const toggleMenu = useCallback((menu: 'sort' | 'filter') => {
    setTagMenuTarget(null);
    setOpenMenu((current) => current === menu ? null : menu);
  }, []);

  const toggleTagMenu = useCallback((target: 'new' | 'edit') => {
    setOpenMenu(null);
    setTagMenuTarget((current) => current === target ? null : target);
  }, []);

  return (
    <>
      <ScreenScroll>
        <ProgressBackButton />

        <View style={{ paddingHorizontal: 2, paddingBottom: space[1] }}>
          <Eyebrow>Body composition</Eyebrow>
          <Text style={t.text('screenTitle')}>Progress</Text>
          <Text style={[t.text('bodyS', 'textMuted'), { marginTop: 4 }]}>{detailLine}</Text>
        </View>

        <PrivacyPromise />

        {(photos.length === 0 || pendingUri) && (
          <Card style={{ gap: space[4], zIndex: tagMenuTarget === 'new' ? 70 : 1 }}>
            <View>
              <Eyebrow>New photo</Eyebrow>
              <Text style={t.text('bodyS', 'textMuted')}>
                {pendingUri ? 'Review the draft before saving it to your local timeline.' : 'Choose a pose, then add a photo from camera or library.'}
              </Text>
            </View>
            <PoseSelector value={pose} onChange={setPose} />
            {pendingUri && (
              <View style={{ gap: space[2] }}>
                <Text style={t.text('labelCaps', 'textMuted')}>Selected photo</Text>
                <Image
                  source={{ uri: pendingUri }}
                  resizeMode="cover"
                  style={{
                    width: '100%',
                    aspectRatio: 0.82,
                    borderRadius: radius.card,
                    backgroundColor: t.colors.bgSurface2,
                  }}
                />
              </View>
            )}
            {pendingUri && (
              <>
                <View style={{ flexDirection: 'row', gap: space[3] }}>
                  <InputBox
                    label="Body weight"
                    value={bodyWeight}
                    onChangeText={setBodyWeight}
                    placeholder="Optional"
                    keyboardType="decimal-pad"
                  />
                  <InputBox label="Note" value={note} onChangeText={setNote} placeholder="Optional" />
                </View>
                <View style={{ zIndex: 40 }}>
                  <TagDropdown
                    selectedTags={selectedTags}
                    availableTags={availableTags}
                    open={tagMenuTarget === 'new'}
                    onPress={() => toggleTagMenu('new')}
                    onRemoveTag={removeDraftTag}
                    onToggleTag={(tag) => toggleTagForTarget('new', tag)}
                    onDeleteTag={confirmDeleteTag}
                    newTagDraft={newTagDraft}
                    onNewTagDraftChange={setNewTagDraft}
                    onCreateTag={() => createTagForTarget('new')}
                  />
                </View>
              </>
            )}
            <View style={{ flexDirection: 'row', gap: space[3] }}>
              <Button
                title={pendingUri ? 'Retake' : 'Camera'}
                disabled={busy}
                onPress={() => void handlePickPhoto('camera')}
                style={{ flex: 1 }}
              />
              <Button
                title={pendingUri ? 'Replace' : 'Library'}
                ghost
                disabled={busy}
                onPress={() => void handlePickPhoto('library')}
                style={{ flex: 1 }}
              />
            </View>
            {pendingUri && (
              <View style={{ flexDirection: 'row', gap: space[3], marginTop: -space[1] }}>
                <Button
                  title={busy ? 'Saving' : 'Save photo'}
                  disabled={busy}
                  onPress={() => void handleSavePhoto()}
                  style={{ flex: 1 }}
                />
                <Button
                  title="Clear"
                  ghost
                  disabled={busy}
                  onPress={clearPendingPhoto}
                  style={{ flex: 1 }}
                />
              </View>
            )}
          </Card>
        )}

        {photos.length > 0 && (
          <Card style={{ gap: space[4], zIndex: openMenu ? 60 : 1 }}>
            <View>
              <Eyebrow>Find photos</Eyebrow>
              <TextInput
                value={dateQuery}
                onChangeText={setDateQuery}
                onFocus={() => {
                  setOpenMenu(null);
                  setTagMenuTarget(null);
                }}
                placeholder="Search by date"
                placeholderTextColor={t.colors.textFaint}
                style={[
                  t.text('bodyM'),
                  {
                    height: 50,
                    lineHeight: 18,
                    borderRadius: radius.control,
                    borderWidth: borderWidth.hairline,
                    borderColor: t.colors.borderHairline,
                    backgroundColor: t.colors.bgSurface2,
                    paddingHorizontal: 12,
                    paddingTop: 0,
                    paddingBottom: 0,
                    textAlignVertical: 'center',
                  },
                ]}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: space[3], zIndex: 50 }}>
              <DropdownButton
                label="Sort"
                value={SORT_LABELS[sortMode]}
                open={openMenu === 'sort'}
                onPress={() => toggleMenu('sort')}
              >
                {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
                  <MenuOption
                    key={mode}
                    label={SORT_LABELS[mode]}
                    selected={sortMode === mode}
                    onPress={() => {
                      setSortMode(mode);
                      setOpenMenu(null);
                    }}
                  />
                ))}
              </DropdownButton>
              <DropdownButton
                label="Filter"
                value={filterLabel}
                open={openMenu === 'filter'}
                onPress={() => toggleMenu('filter')}
                align="right"
                menuWidth={274}
                maxMenuHeight={196}
              >
                <View style={{ gap: space[1] }}>
                  <Text style={[t.text('labelCaps', 'textMuted'), { paddingHorizontal: 11, paddingTop: 2 }]}>Pose</Text>
                  <MenuOption label="All poses" selected={poseFilter === 'all'} onPress={() => setPoseFilter('all')} />
                  {PROGRESS_PHOTO_POSES.map((photoPose) => (
                    <MenuOption
                      key={photoPose}
                      label={POSE_LABELS[photoPose]}
                      selected={poseFilter === photoPose}
                      onPress={() => setPoseFilter(photoPose)}
                    />
                  ))}
                </View>
                <View style={{ height: borderWidth.hairline, backgroundColor: t.colors.borderHairline, marginVertical: 4 }} />
                <View style={{ gap: space[1] }}>
                  <Text style={[t.text('labelCaps', 'textMuted'), { paddingHorizontal: 11, paddingTop: 2 }]}>Tags</Text>
                  <MenuOption label="All tags" selected={tagFilter === 'all'} onPress={() => setTagFilter('all')} />
                  {availableTags.length === 0 ? (
                    <Text style={[t.text('bodyS', 'textMuted'), { paddingHorizontal: 11, paddingVertical: 8 }]}>
                      Create a tag on a photo to filter by tag.
                    </Text>
                  ) : (
                    availableTags.map((tag) => (
                      <MenuOption
                        key={tag}
                        label={`#${tag}`}
                        selected={tagFilter === tag}
                        onPress={() => setTagFilter(tag)}
                      />
                    ))
                  )}
                </View>
              </DropdownButton>
            </View>
          </Card>
        )}

        {photos.length === 0 ? (
          <Card>
            <Text style={t.text('bodyM')}>No progress photos yet.</Text>
            <Text style={[t.text('bodyS', 'textMuted'), { marginTop: 4 }]}>
              Use Camera or Library to start a local, private body timeline.
            </Text>
          </Card>
        ) : visiblePhotos.length === 0 ? (
          <Card>
            <Text style={t.text('bodyM')}>No photos match.</Text>
            <Text style={[t.text('bodyS', 'textMuted'), { marginTop: 4 }]}>
              Try a different date, pose, tag, or sort.
            </Text>
          </Card>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[3] }}>
            {visiblePhotos.map((photo) => (
              <PhotoTile
                key={photo.id}
                photo={photo}
                onEdit={openEditPhoto}
                onDelete={handleDelete}
                onPreview={setPreviewPhoto}
              />
            ))}
          </View>
        )}

        {photos.length > 0 && !pendingUri && (
          <Card style={{ gap: space[3] }}>
            <View>
              <Eyebrow>Add photo</Eyebrow>
              <Text style={t.text('bodyS', 'textMuted')}>
                Draft details open after you choose a camera or library image.
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: space[3] }}>
              <Button
                title="Camera"
                disabled={busy}
                onPress={() => void handlePickPhoto('camera')}
                style={{ flex: 1 }}
              />
              <Button
                title="Library"
                ghost
                disabled={busy}
                onPress={() => void handlePickPhoto('library')}
                style={{ flex: 1 }}
              />
            </View>
          </Card>
        )}
      </ScreenScroll>
      <PhotoPreviewModal photo={previewPhoto} onClose={() => setPreviewPhoto(null)} />
      <EditPhotoModal
        photo={editingPhoto}
        pose={editPose}
        bodyWeight={editBodyWeight}
        note={editNote}
        selectedTags={editSelectedTags}
        availableTags={availableTags}
        tagMenuOpen={tagMenuTarget === 'edit'}
        newTagDraft={newTagDraft}
        busy={editBusy}
        onPoseChange={setEditPose}
        onBodyWeightChange={setEditBodyWeight}
        onNoteChange={setEditNote}
        onToggleTagMenu={() => toggleTagMenu('edit')}
        onRemoveTag={removeEditTag}
        onCreateTag={() => createTagForTarget('edit')}
        onToggleTag={(tag) => toggleTagForTarget('edit', tag)}
        onDeleteTag={confirmDeleteTag}
        onNewTagDraftChange={setNewTagDraft}
        onCancel={closeEditPhoto}
        onSave={() => void handleUpdatePhoto()}
      />
    </>
  );
}
