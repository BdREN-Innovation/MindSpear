<?php

namespace App\Deck\Slides;

use App\Models\Deck\DeckSessionSlideRun;
use Illuminate\Support\Collection;
use LogicException;
use ReflectionClass;
use Symfony\Component\Finder\Finder;

/**
 * Every slide type, by key. Bound as a singleton by DeckServiceProvider,
 * which fills it from discover(): drop a class under app/Deck/Slides/Types
 * and it is registered — no provider edits.
 */
class SlideTypeRegistry
{
    /** @var array<string, SlideTypeContract> */
    private array $types = [];

    public function register(SlideTypeContract $type): void
    {
        $key = $type->key();

        if (isset($this->types[$key]) && $type::class !== $this->types[$key]::class) {
            throw new LogicException("Slide type [{$key}] is registered twice: " . $this->types[$key]::class . ' and ' . $type::class . '.');
        }

        $this->types[$key] = $type;
    }

    public function has(string $key): bool
    {
        return isset($this->types[$key]);
    }

    /** @throws UnknownSlideType */
    public function for(string $key): SlideTypeContract
    {
        return $this->types[$key] ?? throw UnknownSlideType::forKey($key);
    }

    /** @return array<string, SlideTypeContract> keyed by type key, sorted */
    public function all(): array
    {
        ksort($this->types);

        return $this->types;
    }

    /** @return array<string, SlideTypeContract> types available to a product ('quest' | 'quiz') */
    public function forProduct(string $product): array
    {
        return array_filter($this->all(), fn (SlideTypeContract $type) => in_array($product, $type->products(), true));
    }

    /** @return list<string> */
    public function keys(): array
    {
        return array_keys($this->all());
    }

    /**
     * Aggregate of a run from its snapshots (never the authoring slide).
     * Loads the run's answers when none are given.
     */
    public function aggregate(DeckSessionSlideRun $run, ?Collection $answers = null): array
    {
        $answers ??= $run->answers()->orderBy('id')->get();

        return $this->for($run->type_snapshot)->aggregate(
            $run->config_snapshot ?? [],
            $run->options_snapshot ?? [],
            $answers,
        );
    }

    /**
     * Concrete SlideTypeContract classes under $directory (recursive), mapped
     * to class names PSR-4 style from $namespace.
     *
     * @return list<class-string<SlideTypeContract>>
     */
    public static function discover(string $directory, string $namespace): array
    {
        if (! is_dir($directory)) {
            return [];
        }

        $classes = [];
        $files = Finder::create()->files()->in($directory)->name('*.php')->sortByName();

        foreach ($files as $file) {
            $relative = str_replace(['/', '.php'], ['\\', ''], $file->getRelativePathname());
            $class = rtrim($namespace, '\\') . '\\' . $relative;

            if (! class_exists($class)) {
                continue;
            }

            $reflection = new ReflectionClass($class);
            if ($reflection->isInstantiable() && $reflection->implementsInterface(SlideTypeContract::class)) {
                $classes[] = $class;
            }
        }

        return $classes;
    }
}
